/**
 * Service abstraction layer for RAG components.
 * Swap embedding provider or vector store without touching retrieval logic.
 */

/** A single KB chunk with its embedding, ready for storage */
export interface ChunkWithEmbedding {
    pageId: string;
    type: string;
    language: string | null;
    title: string | null;
    contentOriginal: string;
    contentNormalized: string;
    titleNormalized: string | null;
    tokenCount: number;
    metadata: Record<string, unknown>;
    embedding: number[];
    kbVersion: number;
}

/** A chunk returned from similarity search with its score */
export interface ScoredChunk {
    id: string;
    type: string;
    language: string | null;
    title: string | null;
    contentOriginal: string;
    vectorScore: number;
    textScore: number;
    finalScore: number;
}

/** Swap embedding provider without touching retrieval logic */
export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getDimensions(): number;
}

/** Swap vector store without touching retrieval logic */
export interface VectorStore {
    upsertChunks(pageId: string, chunks: ChunkWithEmbedding[]): Promise<void>;
    searchSimilar(pageId: string, queryVector: number[], topK: number, kbActiveVersion: number): Promise<ScoredChunk[]>;
    deleteByPage(pageId: string): Promise<void>;
    deleteByPageVersion(pageId: string, kbVersion: number): Promise<void>;
}
