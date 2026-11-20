"""
Authentication Service
Handles Google OAuth ID token verification, JWT issuance/decoding (HS256),
and the get_current_user FastAPI dependency enforcing is_active checks.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlmodel import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import User

# HTTP Bearer security scheme (auto_error=False to provide custom 401 response)
security_bearer = HTTPBearer(auto_error=False)


def verify_google_id_token(
    id_token: str,
    settings: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Verifies a Google OAuth ID token.
    Supports deterministic mock tokens strictly in offline/testing/development mode:
    Format: 'mock_google_token_<google_id>_<email>_<name>'
    In production: mock tokens are strictly rejected with HTTP 401 Unauthorized;
    delegates verification to google.oauth2.id_token.verify_oauth2_token.
    """
    if settings is None:
        settings = get_settings()

    # 1. Mock token format handling
    if id_token.startswith("mock_google_token_") or id_token.startswith("mock_"):
        # Strictly gate mock token acceptance to testing and development environments
        if settings.ENVIRONMENT in ("testing", "development"):
            prefix = "mock_google_token_" if id_token.startswith("mock_google_token_") else "mock_"
            rem = id_token[len(prefix):]
            parts = rem.split("_")
            
            at_indices = [i for i, p in enumerate(parts) if "@" in p]
            if at_indices:
                email_idx = at_indices[0]
                google_id = "_".join(parts[:email_idx])
                email = parts[email_idx]
                name = "_".join(parts[email_idx + 1:]) if len(parts) > email_idx + 1 else "Mock User"
            else:
                google_id = parts[0] if len(parts) > 0 else "mock_google_sub_123"
                email = parts[1] if len(parts) > 1 else f"{google_id}@example.com"
                name = "_".join(parts[2:]) if len(parts) > 2 else "Mock User"


            return {
                "sub": google_id,
                "email": email,
                "name": name,
                "picture": "https://lh3.googleusercontent.com/mock-avatar.png",
                "email_verified": True,
            }

        # In production (or any non-dev/non-testing environment), mock tokens are strictly forbidden
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Mock authentication tokens are forbidden in production",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Production Google OAuth verification
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        request = google_requests.Request()
        id_info = google_id_token.verify_oauth2_token(
            id_token,
            request,
            audience=settings.GOOGLE_CLIENT_ID
        )
        if not id_info.get("sub"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token payload missing 'sub' claim",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return id_info
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google ID token: {str(exc)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def create_access_token(
    data: Dict[str, Any],
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Issues a signed HS256 JWT access token.
    """
    settings = get_settings()
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": now,
    })
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    """
    Decodes and validates an HS256 JWT access token.
    Raises HTTP 401 Unauthorized if expired, malformed, or signature invalid.
    """
    settings = get_settings()
    if settings.ENVIRONMENT in ("development", "testing"):
        if token in ("mock-jwt-token-alex-dev", "demo-jwt-token-alex-student") or token.startswith("mock-jwt-"):
            return {
                "sub": "usr-default-001",
                "is_active": True,
                "email": "student@university.edu",
            }

    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    session: AsyncSession = Depends(get_session)
) -> User:
    """
    FastAPI dependency enforcing strict authentication and session validity:
    1. Extracts Bearer token (HTTP 401 if missing).
    2. Decodes JWT payload (HTTP 401 if expired or forged).
    3. Fetches user row by ID (HTTP 401 if not found).
    4. Validates user.is_active is True (HTTP 401 Unauthorized if deactivated).
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    payload = decode_access_token(token)
    user_id: Optional[str] = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    statement = select(User).where(User.id == user_id)
    result = await session.execute(statement)
    user = result.scalar_one_or_none()

    settings = get_settings()
    if not user:
        if settings.ENVIRONMENT in ("development", "testing") and user_id == "usr-default-001":
            user = User(
                id="usr-default-001",
                google_id="demo-student-google-id",
                email="student@university.edu",
                name="Alex Student",
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
            session.add(user)
            try:
                await session.commit()
                await session.refresh(user)
            except Exception:
                await session.rollback()
                result = await session.execute(statement)
                user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # SEC-07 / SEC-08: Deactivated users are rejected immediately on every request
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user
