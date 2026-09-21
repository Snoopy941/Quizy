export interface DeckData {
  deck: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    pdfUrl: string | null;
    pinned: boolean;
    shareId: string | null;
    genStatus: string;
    genProgress: number;
    genError: string | null;
    lastStudiedAt: string | null;
  };
  cards: CardRow[];
  chunks: ChunkRow[];
  stats: Stats;
  activeSession: { id: string; mode: string } | null;
}

export interface CardRow {
  id: string;
  front: string;
  back: string;
  type: string;
  options: string[] | null;
  difficulty: string;
  category: string;
  position: number;
  chunkId: string | null;
  dueDate: string;
  intervalDays: number;
  reps: number;
  lapses: number;
  timesSeen: number;
  timesFailed: number;
}

export interface ChunkRow {
  id: string;
  position: number;
  heading: string;
  status: string;
  cardCount: number;
}

export interface Stats {
  total: number;
  new: number;
  learning: number;
  mastered: number;
  dueToday: number;
  masteryPct: number;
}
