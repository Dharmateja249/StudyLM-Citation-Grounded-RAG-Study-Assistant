import {
  mockUser,
  mockNotebooks,
  mockSources,
  mockMessages,
} from './fixtures';
import {
  NotebookRead,
  SourceRead,
  MessageRead,
  UserProfileResponse,
} from '@/types/api';

class MockDatabase {
  users: Map<string, UserProfileResponse> = new Map();
  notebooks: Map<string, NotebookRead> = new Map();
  sources: Map<string, SourceRead> = new Map();
  messages: Map<string, MessageRead[]> = new Map();
  queryCounts: Map<string, number> = new Map();
  rateLimitOverride = false;

  constructor() {
    this.reset();
  }

  reset() {
    this.users.clear();
    this.notebooks.clear();
    this.sources.clear();
    this.messages.clear();
    this.queryCounts.clear();
    this.rateLimitOverride = false;

    this.users.set(mockUser.id, { ...mockUser });
    mockNotebooks.forEach((nb) => this.notebooks.set(nb.id, { ...nb }));
    mockSources.forEach((src) => this.sources.set(src.id, { ...src }));
    this.messages.set('nb-physics-101', [...mockMessages]);
  }
}

export const mockDb = new MockDatabase();
