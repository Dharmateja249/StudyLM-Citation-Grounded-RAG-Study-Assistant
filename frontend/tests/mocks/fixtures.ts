import {
  NotebookRead,
  SourceRead,
  UserProfileResponse,
  MessageRead,
  ResolvedCitation,
} from '@/types/api';

export const mockUser: UserProfileResponse = {
  id: 'usr-default-001',
  email: 'student@university.edu',
  name: 'Alex Student',
  avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
  is_active: true,
  last_active_notebook_id: 'nb-physics-101',
  created_at: '2026-09-01T08:00:00Z',
};

export const mockDeactivatedUser: UserProfileResponse = {
  id: 'usr-deactivated-002',
  email: 'deactivated@university.edu',
  name: 'Former Student',
  avatar_url: undefined,
  is_active: false,
  last_active_notebook_id: undefined,
  created_at: '2026-08-01T08:00:00Z',
};

export const mockNotebooks: NotebookRead[] = [
  {
    id: 'nb-physics-101',
    user_id: 'usr-default-001',
    title: 'Physics 101: Classical Mechanics',
    status: 'active',
    created_at: '2026-09-01T08:30:00Z',
  },
  {
    id: 'nb-bio-201',
    user_id: 'usr-default-001',
    title: 'Cellular Biology 201',
    status: 'active',
    created_at: '2026-09-05T10:00:00Z',
  },
  {
    id: 'nb-deleting',
    user_id: 'usr-default-001',
    title: 'Old Chemistry Notes',
    status: 'deleting',
    created_at: '2026-09-02T12:00:00Z',
  },
];

export const mockCitations: ResolvedCitation[] = [
  {
    marker_id: 1,
    source_id: 'src-pdf-001',
    source_title: 'Mechanics_Lecture_01.pdf',
    source_type: 'pdf',
    page_number: 42,
    bboxes: [
      [0.12, 0.35, 0.88, 0.38],
      [0.12, 0.39, 0.65, 0.42],
    ],
    deep_link: '/sources/src-pdf-001/stream#page=42',
    quote:
      "Newton's second law states that the acceleration of an object is directly proportional to the net force acting upon it and inversely proportional to its mass.",
  },
  {
    marker_id: 2,
    source_id: 'src-yt-002',
    source_title: "MIT 8.01x Lecture 3: Newton's Laws",
    source_type: 'youtube',
    start_seconds: 742,
    bboxes: [],
    deep_link: 'https://youtube.com/watch?v=kYv_8fX30yA&t=742s',
    quote:
      'Now let us look at the vector representation of F equals ma on an inclined plane.',
  },
  {
    marker_id: 3,
    source_id: 'src-pdf-scanned',
    source_title: 'Historical_Mechanics_Scanned.pdf',
    source_type: 'pdf',
    page_number: 15,
    bboxes: [], // Empty bboxes indicating scanned OCR fallback
    deep_link: '/sources/src-pdf-scanned/stream#page=15',
    quote: 'Every body perseveres in its state of being at rest or of moving uniformly forward.',
  },
  {
    marker_id: 4,
    source_id: 'src-yt-002',
    source_title: "MIT 8.01x Lecture 3: Newton's Laws",
    source_type: 'youtube',
    start_seconds: 1394,
    bboxes: [],
    deep_link: 'https://youtube.com/watch?v=kYv_8fX30yA&t=1394s',
    quote: 'When the angle exceeds the critical angle, static friction can no longer prevent slipping.',
  },
];

export const mockScannedCitation: ResolvedCitation = mockCitations[2];
export const mockYouTubeSeekCitation: ResolvedCitation = mockCitations[3];

export const mockSources: SourceRead[] = [
  {
    id: 'src-pdf-001',
    user_id: 'usr-default-001',
    notebook_id: 'nb-physics-101',
    title: 'Mechanics_Lecture_01.pdf',
    source_type: 'pdf',
    storage_key_or_url:
      'users/usr-default-001/notebooks/nb-physics-101/src-pdf-001/Mechanics_Lecture_01.pdf',
    file_size_bytes: 4194304,
    page_count: 54,
    estimated_tokens: 24500,
    active_ingest_run_id: 'run-001',
    status: 'ready',
    reindexing: false,
    summary:
      'Comprehensive introduction to classical Newtonian mechanics, kinematics, and coordinate transforms.',
    summary_status: 'ready',
    created_at: '2026-09-01T09:00:00Z',
  },
  {
    id: 'src-yt-002',
    user_id: 'usr-default-001',
    notebook_id: 'nb-physics-101',
    title: "MIT 8.01x Lecture 3: Newton's Laws",
    source_type: 'youtube',
    storage_key_or_url: 'https://www.youtube.com/watch?v=kYv_8fX30yA',
    duration_seconds: 3120,
    estimated_tokens: 18200,
    active_ingest_run_id: 'run-002',
    status: 'ready',
    reindexing: false,
    summary:
      "Prof. Walter Lewin delivers lecture 3 covering forces, friction, and Newton's three laws.",
    summary_status: 'ready',
    created_at: '2026-09-01T09:30:00Z',
  },
  {
    id: 'src-yt-rejected',
    user_id: 'usr-default-001',
    notebook_id: 'nb-physics-101',
    title: '[Suppressed: Non-Educational Content]',
    source_type: 'youtube',
    storage_key_or_url: 'https://www.youtube.com/watch?v=entertainment123',
    status: 'error',
    reindexing: false,
    error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
    error_message:
      'Upload educational related video, this video does not have educational content please recheck the link',
    summary_status: 'error',
    created_at: '2026-09-01T10:00:00Z',
  },
  {
    id: 'src-pdf-scanned',
    user_id: 'usr-default-001',
    notebook_id: 'nb-physics-101',
    title: 'Historical_Mechanics_Scanned.pdf',
    source_type: 'pdf',
    storage_key_or_url:
      'users/usr-default-001/notebooks/nb-physics-101/src-pdf-scanned/Historical_Mechanics_Scanned.pdf',
    file_size_bytes: 8388608,
    page_count: 50,
    estimated_tokens: 35000,
    active_ingest_run_id: 'run-003',
    status: 'ready',
    reindexing: false,
    summary: 'Archived scans of historic mechanics treatises.',
    summary_status: 'ready',
    created_at: '2026-09-02T11:00:00Z',
  },
];

export const mockScannedPdfSource: SourceRead = mockSources[3];


export const mockMessages: MessageRead[] = [
  {
    id: 'msg-001',
    notebook_id: 'nb-physics-101',
    role: 'user',
    content: "What is Newton's second law?",
    created_at: '2026-09-01T10:15:00Z',
  },
  {
    id: 'msg-002',
    notebook_id: 'nb-physics-101',
    role: 'assistant',
    content:
      "Newton's second law defines the relationship between net force, mass, and acceleration [[cite:1]].",
    created_at: '2026-09-01T10:15:02Z',
  },
];
