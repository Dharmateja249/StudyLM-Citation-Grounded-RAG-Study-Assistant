"""
Auth Router:
- POST /auth/google: Google OAuth login / account registration / deactivation guard
- GET /auth/me: Returns current authenticated user profile & session resume state
- DELETE /users/me: Deactivates account, sets is_active=False, initiates cascading purge
"""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
import httpx
from sqlmodel import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import User, Notebook, Source
from app.services.auth_service import (
    verify_google_id_token,
    create_access_token,
    get_current_user,
)

logger = logging.getLogger("studylm.auth_router")
router = APIRouter(tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])


# Schemas
class GoogleAuthRequest(BaseModel):
    id_token: str


class UserProfileResponse(BaseModel):
    id: str
    email: EmailStr
    name: str
    avatar_url: Optional[str] = None
    is_active: bool
    last_active_notebook_id: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfileResponse


class DeletionResponse(BaseModel):
    status: str
    message: str


@router.get("/auth/google/login")
@router.get("/v1/auth/google/login")
@router.get("/api/v1/auth/google/login")
async def google_oauth_login(
    redirect_uri: Optional[str] = None,
):
    """
    Initiates Google OAuth 2.0 authorization code flow.
    Forces Google's Account Chooser (prompt=select_account) and redirects
    to Google's authorization endpoint.
    """
    settings = get_settings()
    target_redirect_uri = redirect_uri or "http://localhost:3000/api/auth/callback/google"
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": target_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    google_auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url=google_auth_url, status_code=status.HTTP_302_FOUND)


@router.get("/auth/callback/google")
@router.get("/api/auth/callback/google")
@router.get("/auth/google/callback")
@router.get("/v1/auth/google/callback")
@router.get("/api/v1/auth/google/callback")
async def google_oauth_callback(
    code: Optional[str] = None,
    error: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    """
    Handles Google OAuth 2.0 callback with authorization code.
    Exchanges code for tokens, verifies Google ID token, registers or logs in the user,
    and redirects the browser to the frontend workspace with JWT token.
    """
    if error or not code:
        err_msg = error or "Authorization code was not provided by Google"
        return RedirectResponse(
            url=f"http://localhost:3000/?auth_error={err_msg}",
            status_code=status.HTTP_302_FOUND,
        )

    settings = get_settings()
    redirect_uri = "http://localhost:3000/api/auth/callback/google"

    token_endpoint = "https://oauth2.googleapis.com/token"
    token_payload = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_res = await client.post(token_endpoint, data=token_payload)
    except Exception as exc:
        return RedirectResponse(
            url=f"http://localhost:3000/?auth_error=network_error_{str(exc)}",
            status_code=status.HTTP_302_FOUND,
        )

    if token_res.status_code != 200:
        return RedirectResponse(
            url="http://localhost:3000/?auth_error=token_exchange_failed",
            status_code=status.HTTP_302_FOUND,
        )

    token_json = token_res.json()
    id_token_str = token_json.get("id_token")
    if not id_token_str:
        return RedirectResponse(
            url="http://localhost:3000/?auth_error=missing_id_token",
            status_code=status.HTTP_302_FOUND,
        )

    try:
        token_info = verify_google_id_token(id_token_str, settings=settings)
    except HTTPException as exc:
        return RedirectResponse(
            url=f"http://localhost:3000/?auth_error={exc.detail}",
            status_code=status.HTTP_302_FOUND,
        )

    google_id = token_info["sub"]
    email = token_info.get("email")
    name = token_info.get("name", "User")
    avatar_url = token_info.get("picture")

    if not email:
        return RedirectResponse(
            url="http://localhost:3000/?auth_error=google_id_missing_email",
            status_code=status.HTTP_302_FOUND,
        )

    statement = select(User).where(
        (User.google_id == google_id) | (User.email == email)
    )
    result = await session.execute(statement)
    user = result.scalar_one_or_none()

    if user:
        if not user.is_active:
            return RedirectResponse(
                url="http://localhost:3000/?auth_error=Account_pending_deletion",
                status_code=status.HTTP_302_FOUND,
            )
        user.name = name
        if avatar_url:
            user.avatar_url = avatar_url
        session.add(user)
        await session.commit()
        await session.refresh(user)
    else:
        user = User(
            id=str(uuid.uuid4()),
            google_id=google_id,
            email=email,
            name=name,
            avatar_url=avatar_url,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    access_token = create_access_token(data={"sub": user.id, "email": user.email})

    params = {
        "token": access_token,
        "user_id": user.id,
        "email": user.email,
        "name": user.name,
    }
    if user.avatar_url:
        params["avatar"] = user.avatar_url

    redirect_target = f"http://localhost:3000/?{urlencode(params)}"
    return RedirectResponse(url=redirect_target, status_code=status.HTTP_302_FOUND)


@router.post("/auth/google", response_model=TokenResponse)
@router.post("/auth/google/", response_model=TokenResponse, include_in_schema=False)
async def login_with_google(
    payload: GoogleAuthRequest,
    session: AsyncSession = Depends(get_session)
):
    """
    Verifies Google ID token.
    If user exists:
      - If user.is_active is False: rejects with HTTP 403 ('Account pending deletion') [SEC-08]
      - Else: updates profile, returns JWT and user profile.
    If user does not exist: creates new active user and returns JWT.
    """
    token_info = verify_google_id_token(payload.id_token)
    google_id = token_info["sub"]
    email = token_info.get("email")
    name = token_info.get("name", "User")
    avatar_url = token_info.get("picture")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google ID token does not contain an email address",
        )

    statement = select(User).where(
        (User.google_id == google_id) | (User.email == email)
    )
    result = await session.execute(statement)
    user = result.scalar_one_or_none()

    if user:
        # SEC-08: Deactivated user attempting re-login must be blocked with 403 Forbidden
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account pending deletion",
            )
        # Update user profile info
        user.name = name
        user.avatar_url = avatar_url
        session.add(user)
        await session.commit()
        await session.refresh(user)
    else:
        # Create new user
        user = User(
            id=str(uuid.uuid4()),
            google_id=google_id,
            email=email,
            name=name,
            avatar_url=avatar_url,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    access_token = create_access_token(data={"sub": user.id, "email": user.email})

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserProfileResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            is_active=user.is_active,
            last_active_notebook_id=user.last_active_notebook_id,
            created_at=user.created_at,
        ),
    )


@router.get("/auth/me", response_model=UserProfileResponse)
@router.get("/auth/me/", response_model=UserProfileResponse, include_in_schema=False)
@router.get("/v1/auth/me", response_model=UserProfileResponse, include_in_schema=False)
@router.get("/v1/auth/me/", response_model=UserProfileResponse, include_in_schema=False)
@router.get("/api/v1/auth/me", response_model=UserProfileResponse, include_in_schema=False)
@router.get("/api/v1/auth/me/", response_model=UserProfileResponse, include_in_schema=False)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    Returns current authenticated user profile including last_active_notebook_id.
    Fulfills SEC-05 session resume state.
    """
    # If last_active_notebook_id is not set, resolve the latest active notebook if present
    if not current_user.last_active_notebook_id:
        stmt = (
            select(Notebook.id)
            .where(
                Notebook.user_id == current_user.id,
                Notebook.status == "active"
            )
            .order_by(Notebook.created_at.desc())
            .limit(1)
        )
        res = await session.execute(stmt)
        latest_nb_id = res.scalar_one_or_none()
        if latest_nb_id:
            current_user.last_active_notebook_id = latest_nb_id
            session.add(current_user)
            await session.commit()
            await session.refresh(current_user)

    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        avatar_url=current_user.avatar_url,
        is_active=current_user.is_active,
        last_active_notebook_id=current_user.last_active_notebook_id,
        created_at=current_user.created_at,
    )


@router.delete("/users/me", response_model=DeletionResponse)
@router.delete("/users/me/", response_model=DeletionResponse, include_in_schema=False)
@users_router.delete("/me", response_model=DeletionResponse)
@users_router.delete("/me/", response_model=DeletionResponse, include_in_schema=False)
async def delete_my_account(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    SEC-07: Race-Free Account Deletion Flow
    1. Sets User.is_active = False immediately.
    2. Marks all user notebooks and sources as status = 'deleting'.
    3. Commits transaction. All future calls with user's JWT return 401.
    4. Triggers cascading vector/storage purge.
    """
    # Query user's active notebooks prior to status update
    nb_stmt = select(Notebook).where(
        Notebook.user_id == current_user.id,
        Notebook.status != "deleting",
    )
    nb_res = await session.execute(nb_stmt)
    active_notebooks = list(nb_res.scalars().all())

    # 1. Mark user inactive
    current_user.is_active = False
    session.add(current_user)

    # 2. Mark notebooks as deleting
    await session.execute(
        update(Notebook)
        .where(Notebook.user_id == current_user.id)
        .values(status="deleting")
    )

    # 3. Mark sources as deleting
    await session.execute(
        update(Source)
        .where(Source.user_id == current_user.id)
        .values(status="deleting")
    )

    await session.commit()

    # 4. Enqueue background cascading sweeper task for each active notebook (STOR-07 / Feature 54)
    now_epoch = time.time()
    for nb in active_notebooks:
        try:
            from app.tasks.cleanup_tasks import defer_cleanup_notebook
            await defer_cleanup_notebook(
                notebook_id=nb.id,
                started_at_epoch=now_epoch,
            )
        except Exception as queue_exc:
            logger.warning(
                f"Background notebook cleanup queue defer failed for notebook {nb.id}: {queue_exc}"
            )

    return DeletionResponse(
        status="deleting",
        message="Account deactivation accepted. Cascading purge initiated.",
    )
