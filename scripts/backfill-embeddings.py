#!/usr/bin/env python3
"""
Backfill missing embeddings for existing memories.
Uses BAAI/bge-large-zh-v1.5 via sentence-transformers (same model as JS side).
"""
import sqlite3
import json
import sys
import time
import numpy as np

DB_PATH = "/Users/ahs/Library/Application Support/Gina/data/jarvis.db"

def load_model():
    from sentence_transformers import SentenceTransformer
    print("Loading model BAAI/bge-large-zh-v1.5 ...")
    model = SentenceTransformer("BAAI/bge-large-zh-v1.5")
    print(f"Model loaded. Dim: {model.get_sentence_embedding_dimension()}")
    return model

def get_rows_without_embeddings(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("""
        SELECT mem_id, title, content FROM memories
        WHERE visibility = 1
        AND embedding IS NULL
        AND content IS NOT NULL
        AND TRIM(content) != ''
    """)
    rows = cur.fetchall()
    conn.close()
    return rows

def update_embedding(db_path, mem_id, emb_bytes, model_name="BAAI/bge-large-zh-v1.5"):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    dim = len(np.frombuffer(emb_bytes, dtype=np.float32))
    try:
        cur.execute(
            "UPDATE memories SET embedding = ?, embedding_dim = ?, embedding_model = ? WHERE mem_id = ?",
            (emb_bytes, dim, model_name, mem_id)
        )
    except sqlite3.OperationalError:
        # Fallback: older schema without embedding_dim/embedding_model columns
        cur.execute("UPDATE memories SET embedding = ? WHERE mem_id = ?", (emb_bytes, mem_id))
    conn.commit()
    conn.close()

def main():
    rows = get_rows_without_embeddings(DB_PATH)
    if not rows:
        print("No memories need backfill. Done.")
        return

    print(f"Found {len(rows)} memories without embeddings.")

    model = load_model()

    total = len(rows)
    done = 0
    failed = 0
    batch_size = 32

    for i in range(0, total, batch_size):
        batch = rows[i:i+batch_size]
        texts = []
        ids = []
        for mem_id, title, content in batch:
            text = f"{title or ''} {content or ''}".strip()
            texts.append(text)
            ids.append(mem_id)

        try:
            embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        except Exception as e:
            print(f"  Batch encode failed: {e}")
            failed += len(batch)
            continue

        for mem_id, emb in zip(ids, embeddings):
            emb_bytes = emb.astype(np.float32).tobytes()
            try:
                update_embedding(DB_PATH, mem_id, emb_bytes)
                done += 1
            except Exception as e:
                print(f"  Failed to update {mem_id}: {e}")
                failed += 1

        pct = (i + len(batch)) * 100 // total
        print(f"  Progress: {min(i+len(batch), total)}/{total} ({pct}%)  done={done} failed={failed}")

        if i + batch_size < total:
            time.sleep(0.1)

    print(f"\nDone. Embedded: {done}, Failed: {failed}, Total: {total}")

if __name__ == "__main__":
    main()
