"""
Adversarial Probes and Live Verification Suite for StudyLM External Services.
File: backend/tests/challenger_live_probes.py
Role: Empirical Challenger 1 (Live Services Adversarial Verifier)
"""

import math
import os
import sys
import time
import uuid
import urllib.request
import pytest
import psycopg
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from google import genai
from google.genai.errors import APIError
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from qdrant_client.http.exceptions import UnexpectedResponse

from app.config import get_settings


@pytest.fixture(scope="module")
def settings():
    return get_settings()


class TestChallengerLiveServices:
    """Empirical adversarial verification across Neon, Qdrant, Gemini, and S3."""

    def test_probe_1_neon_adversarial_queries(self, settings):
        """
        Probe Neon PostgreSQL:
        - Verify version & server identity
        - Parameterized query injection resilience
        - Connection timeout / failure immediate abort
        """
        # 1. Version check
        t0 = time.perf_counter()
        with psycopg.connect(settings.DATABASE_URL, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
                assert "PostgreSQL" in version, f"Unexpected DB version: {version}"
                
                # Check public tables exist
                cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")
                tables = {r[0] for r in cur.fetchall()}
                assert {"user", "notebook", "source", "message"}.issubset(tables)

                # Parameterized query with SQL injection string
                injection_str = "test' OR '1'='1'; DROP TABLE non_existent; --"
                cur.execute('SELECT count(*) FROM "user" WHERE email = %s;', (injection_str,))
                res = cur.fetchone()[0]
                assert res == 0, "Injection string matched unexpected rows"
        lat = (time.perf_counter() - t0) * 1000
        print(f"\n[NEON] Connected successfully. Version: {version[:30]}... Latency: {lat:.1f}ms")

        # 2. Bad credentials immediate abort verification
        bad_url = settings.DATABASE_URL.replace("npg_Yfm3pKzOvn4b", "wrong_password_12345")
        t0 = time.perf_counter()
        aborted = False
        try:
            with psycopg.connect(bad_url, connect_timeout=5) as conn:
                pass
        except psycopg.OperationalError as e:
            aborted = True
            print(f"[NEON ABORT] Immediate abort confirmed on bad credentials: {type(e).__name__}")
        assert aborted, "Neon did not abort on bad credentials!"

    def test_probe_2_qdrant_collection_and_tenant_isolation(self, settings):
        """
        Probe Qdrant Cloud:
        - Verify collection schema (768d, Cosine)
        - Adversarial Tenant Isolation: Tenant B must NEVER retrieve Tenant A's vectors
        - Bad credentials immediate abort verification
        """
        client = QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY, timeout=15)
        col_name = settings.QDRANT_COLLECTION_NAME

        # 1. Collection schema inspection
        t0 = time.perf_counter()
        col_info = client.get_collection(col_name)
        assert col_info.config.params.vectors.size == 768
        assert str(col_info.config.params.vectors.distance).lower() in ("distance.cosine", "cosine")
        lat = (time.perf_counter() - t0) * 1000
        print(f"\n[QDRANT] Collection '{col_name}' verified. Size: 768, Distance: Cosine. Latency: {lat:.1f}ms")

        # 2. Tenant isolation probe
        point_id = int(uuid.uuid4().hex[:15], 16)
        user_a = f"challenger_user_A_{uuid.uuid4().hex[:6]}"
        user_b = f"challenger_user_B_{uuid.uuid4().hex[:6]}"
        vector = [0.035] * 768  # unit-like vector
        
        # Upsert point belonging to Tenant A
        client.upsert(
            collection_name=col_name,
            points=[
                qmodels.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={"user_id": user_a, "secret_data": "CONFIDENTIAL_STUDY_NOTE"},
                )
            ],
            wait=True,
        )

        try:
            # Query as Tenant B with identical vector
            filter_b = qmodels.Filter(
                must=[qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=user_b))]
            )
            res_b = client.query_points(
                collection_name=col_name,
                query=vector,
                query_filter=filter_b,
                limit=5,
            )
            assert len(res_b.points) == 0, f"LEAK! Tenant B retrieved Tenant A's points: {res_b.points}"

            # Query as Tenant A
            filter_a = qmodels.Filter(
                must=[qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=user_a))]
            )
            res_a = client.query_points(
                collection_name=col_name,
                query=vector,
                query_filter=filter_a,
                limit=5,
            )
            assert len(res_a.points) == 1, "Tenant A failed to retrieve their own vector"
            assert res_a.points[0].payload["secret_data"] == "CONFIDENTIAL_STUDY_NOTE"
            print(f"[QDRANT] Tenant isolation strictly enforced: Tenant B got 0 results, Tenant A got 1.")
        finally:
            client.delete(
                collection_name=col_name,
                points_selector=qmodels.PointIdsList(points=[point_id]),
                wait=True,
            )
            # Verify deletion
            ret = client.retrieve(collection_name=col_name, ids=[point_id])
            assert len(ret) == 0, "Qdrant cleanup failed"

        # 3. Bad API key immediate abort
        bad_client = QdrantClient(url=settings.QDRANT_URL, api_key="bad_token_challenger_probe_12345", timeout=5)
        aborted = False
        try:
            bad_client.get_collections()
        except Exception as e:
            aborted = True
            print(f"[QDRANT ABORT] Immediate abort confirmed on bad credentials: {type(e).__name__}")
        assert aborted, "Qdrant did not abort on invalid API key!"

    def test_probe_3_gemini_embeddings_and_bad_key_abort(self, settings):
        """
        Probe Google Gemini AI:
        - Generate genuine 768d embedding via gemini-embedding-2
        - Verify norm and values
        - Bad credentials immediate abort verification
        """
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        t0 = time.perf_counter()
        resp = client.models.embed_content(
            model=settings.GEMINI_EMBEDDING_MODEL,
            contents="Empirical challenger probe: testing vector space consistency and dimensions.",
            config={"output_dimensionality": settings.EMBEDDING_DIMENSION},
        )
        lat = (time.perf_counter() - t0) * 1000
        values = resp.embeddings[0].values
        assert len(values) == 768, f"Expected 768, got {len(values)}"
        norm = math.sqrt(sum(v * v for v in values))
        assert 0.95 <= norm <= 1.05, f"Vector not normalized: norm={norm}"
        print(f"\n[GEMINI] Model '{settings.GEMINI_EMBEDDING_MODEL}' produced 768d vector. Norm: {norm:.4f}. Latency: {lat:.1f}ms")

        # Bad key immediate abort
        bad_client = genai.Client(api_key="AQ.BadKeyForAdversarialProbeTesting1234567890")
        aborted = False
        try:
            bad_client.models.embed_content(
                model=settings.GEMINI_EMBEDDING_MODEL,
                contents="test abort",
            )
        except Exception as e:
            aborted = True
            print(f"[GEMINI ABORT] Immediate abort confirmed on bad credentials: {type(e).__name__} ({str(e)[:80]})")
        assert aborted, "Gemini did not abort on invalid API key!"

    def test_probe_4_s3_presigned_download_parity_and_abort(self, settings):
        """
        Probe Supabase S3:
        - Verify bucket existence ('studyLM-sources')
        - Roundtrip binary upload -> Presigned URL generation -> Direct HTTP GET with urllib -> byte parity
        - Object deletion & verification
        - Bad credentials immediate abort
        """
        s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=10.0)
        s3 = boto3.client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=s3_cfg,
        )
        bucket = settings.R2_BUCKET_NAME
        assert bucket == "studyLM-sources", f"Unexpected bucket name: {bucket}"

        # 1. Bucket check
        t0 = time.perf_counter()
        buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
        assert bucket in buckets, f"Bucket '{bucket}' not found in {buckets}"
        lat = (time.perf_counter() - t0) * 1000
        print(f"\n[S3] Bucket '{bucket}' verified. Latency: {lat:.1f}ms")

        # 2. Binary content roundtrip & presigned URL direct HTTP download
        raw_payload = os.urandom(2048)  # 2KB random binary
        test_key = f"challenger_probe/{uuid.uuid4().hex}/binary_parity_test.bin"

        try:
            s3.put_object(
                Bucket=bucket,
                Key=test_key,
                Body=raw_payload,
                ContentType="application/octet-stream",
            )

            # Generate presigned URL
            presigned_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": test_key},
                ExpiresIn=300,
            )
            assert presigned_url.startswith("https://")

            # Direct HTTP fetch using standard urllib (proves URL is truly signed and publicly accessible)
            req = urllib.request.Request(presigned_url, headers={"User-Agent": "ChallengerProbe/1.0"})
            with urllib.request.urlopen(req, timeout=10) as response:
                assert response.status == 200
                fetched_bytes = response.read()

            assert fetched_bytes == raw_payload, "Direct HTTP presigned GET byte mismatch!"
            print(f"[S3] Direct HTTP presigned download verified 2048-byte exact match.")
        finally:
            s3.delete_object(Bucket=bucket, Key=test_key)
            list_res = s3.list_objects_v2(Bucket=bucket, Prefix=test_key)
            assert list_res.get("KeyCount", 0) == 0, "S3 cleanup failed"

        # 3. Bad credentials immediate abort
        bad_s3 = boto3.client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id="INVALID_ACCESS_KEY_ID",
            aws_secret_access_key="INVALID_SECRET_KEY",
            region_name="auto",
            config=s3_cfg,
        )
        aborted = False
        try:
            bad_s3.list_buckets()
        except ClientError as e:
            aborted = True
            print(f"[S3 ABORT] Immediate abort confirmed on bad credentials: {e.response.get('Error', {}).get('Code')}")
        assert aborted, "S3 did not abort on invalid credentials!"
