# Knowledge ingestion, retrieval, embeddings and model training

Reviewed: 2026-09-08. Classification: public technical reference.

Ingestion stores source material. Retrieval selects relevant portions for an inference request. Inference generates a response using a model and supplied context. Fine-tuning changes model parameters through a separate training process. Adding documents to a knowledge graph is not model training and cannot transfer another assistant's capabilities or private internal reasoning.

Ollama's embeddings endpoint produces vectors for semantic similarity. Its documentation describes cosine similarity, batch input, and using the same embedding model for indexing and querying. [Source: Ollama embeddings](https://docs.ollama.com/capabilities/embeddings)

Index complete extracted text in bounded chunks, retaining source identity and offsets. Stable IDs make repeated imports idempotent. If content changes, invalidate its old embedding; unchanged content should retain its original evidence freshness. Retire obsolete chunks without deleting unrelated user data. Surface failed extraction and stale sources.

Combine keyword and semantic retrieval where appropriate. Preserve source IDs, dates and trust categories in the prompt, not just text fragments. Similarity measures relevance, not truth. Conversation history provides requirements and continuity, but an earlier model answer is not independent confirmation. Evaluate retrieval separately from generation using questions whose relevant source passages are known. A large corpus with poor provenance can reduce answer quality.
