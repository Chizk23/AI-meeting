import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Key,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import { format } from 'date-fns';
import type { AxiosError } from 'axios';
import api from '../../../services/api';
import { normalizeMeetingDetail } from '../../../services/mappers';
import type { ActionItem, MeetingDetail as MeetingDetailType, MeetingTranscriptSegment, AnchoredTextItem } from '../../../types';
import AudioPlayer, { type AudioPlayerHandle } from '../../meeting/components/AudioPlayer';
import ActionItemComposer from '../../meeting/components/ActionItemComposer';
import MeetingActionItemCard from '../../meeting/components/MeetingActionItemCard';
import { useAuth } from '../../../context/AuthContext';
import { showToast, EditTitleModal, Modal, PageState } from '../../../components/ui';
import type { ActionItemAssigneeOption, TranscriptAnchor } from '../../../types/actionItem';

type DetailTab = 'summary' | 'transcript' | 'actions' | 'ai-notes';
type ActionFilter = 'all' | 'mine' | 'unassigned' | 'completed';

type TranscriptGroup = {
  id: string;
  speakerLabel: string;
  speakerRawLabel: string;
  startTime: number;
  endTime: number;
  languages: string[];
  texts: string[];
  corrections: Array<{ wrong: string; right: string; source: string }>;
};

type ActionEditDraft = {
  title: string;
  assignedEmails: string[];
  dueDate: string;
  status: string;
  priority: string;
};

type ExportFormat = 'pdf' | 'docx';
type ExportLanguage = 'vi' | 'en' | 'ja' | 'zh' | 'ko';

const SUPPORTED_MEETING_LANGUAGES = [
  { code: 'vi', label: '🇻🇳 Tiếng Việt' },
  { code: 'en', label: '🇺🇸 English' },
  { code: 'zh', label: '🇨🇳 中文' },
  { code: 'ja', label: '🇯🇵 日本語' },
  { code: 'ko', label: '🇰🇷 한국어' },
];

type ActivityFeedItem = {
  id: string;
  title: string;
  description: string;
  timestamp?: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
};

const TRANSCRIPT_GROUP_GAP_SECONDS = 3;
const groupTranscriptSegments = (segments: MeetingTranscriptSegment[]): TranscriptGroup[] => {
  const sortedSegments = [...segments]
    .filter((segment) => segment.text?.trim())
    .sort((a, b) => a.startTime - b.startTime);

  return sortedSegments.reduce<TranscriptGroup[]>((groups, segment) => {
    const speakerLabel = segment.speakerLabel || 'Speaker_01';
    const language = segment.language || 'auto';
    const lastGroup = groups[groups.length - 1];
    const shouldMerge =
      lastGroup &&
      lastGroup.speakerLabel === speakerLabel &&
      segment.startTime - lastGroup.endTime <= TRANSCRIPT_GROUP_GAP_SECONDS;

    if (shouldMerge) {
      lastGroup.endTime = Math.max(lastGroup.endTime, segment.endTime || segment.startTime);
      lastGroup.texts.push(segment.text.trim());
      if (!lastGroup.languages.includes(language)) {
        lastGroup.languages.push(language);
      }
      if (segment.nlpMetadata?.corrections) {
        lastGroup.corrections.push(...segment.nlpMetadata.corrections);
      }
      return groups;
    }

    groups.push({
      id: segment.id,
      speakerLabel,
      speakerRawLabel: segment.speakerRawLabel || speakerLabel,
      startTime: segment.startTime,
      endTime: segment.endTime || segment.startTime,
      languages: [language],
      texts: [segment.text.trim()],
      corrections: segment.nlpMetadata?.corrections ? [...segment.nlpMetadata.corrections] : [],
    });
    return groups;
  }, []);
};

const formatTimelineDate = (value?: string) => {
  if (!value) return 'Chưa có mốc thời gian';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Chưa có mốc thời gian';
  return format(parsed, 'HH:mm · dd/MM/yyyy');
};

const getApiErrorDetail = (error: unknown, fallback: string) => {
  const axiosError = error as AxiosError<{ detail?: string }>;
  return axiosError.response?.data?.detail || fallback;
};

const buildMeetingActivityFeed = (meeting: MeetingDetailType | undefined, actionItems: ActionItem[]): ActivityFeedItem[] => {
  if (!meeting) return [];
  const creatorLabel =
    meeting.createdByUser?.displayName ||
    meeting.createdByUser?.email ||
    'Hệ thống';

  const items: ActivityFeedItem[] = [
    {
      id: `meeting-created-${meeting.id}`,
      title: 'Cuộc họp được tạo',
      description: `${creatorLabel} đã tạo cuộc họp và chia sẻ ngữ cảnh ban đầu.`,
      timestamp: meeting.createdAt,
      tone: 'neutral',
    },
  ];

  if (meeting.actual_start || meeting.startTime) {
    items.push({
      id: `meeting-start-${meeting.id}`,
      title: 'Cuộc họp bắt đầu',
      description: meeting.status === 'live' ? 'Phòng họp đang diễn ra và người tham gia có thể vào trực tiếp.' : 'Buổi họp đã bắt đầu và dữ liệu đang được thu thập.',
      timestamp: meeting.actual_start || meeting.startTime,
      tone: 'info',
    });
  }

  if (meeting.actual_end) {
    items.push({
      id: `meeting-end-${meeting.id}`,
      title: 'Cuộc họp kết thúc',
      description: 'Bản ghi âm, transcript và AI Notes đã sẵn sàng cho giai đoạn xử lý sau họp.',
      timestamp: meeting.actual_end,
      tone: 'neutral',
    });
  }

  if (meeting.transcriptStatus === 'DRAFT' && meeting.hasTranscriptDraft) {
    items.push({
      id: `transcript-draft-${meeting.id}`,
      title: 'Transcript đang được lưu bản nháp',
      description: 'Hệ thống đã giữ lại transcript gần realtime, kể cả khi AI Notes chưa hoàn tất.',
      timestamp: meeting.updatedAt,
      tone: 'info',
    });
  }

  if (meeting.transcriptStatus === 'COMPLETED') {
    items.push({
      id: `transcript-complete-${meeting.id}`,
      title: 'Transcript đã hoàn tất',
      description: `${meeting.transcriptSegments.length || 0} đoạn transcript đã sẵn sàng để tìm kiếm và nghe lại theo timeline.`,
      timestamp: meeting.updatedAt,
      tone: 'success',
    });
  }

  if (meeting.transcriptStatus === 'FAILED') {
    items.push({
      id: `transcript-failed-${meeting.id}`,
      title: 'Transcript gặp lỗi',
      description: 'Hệ thống chưa hoàn tất transcript chính thức. Bạn vẫn có thể kiểm tra draft hoặc thử lại AI Notes.',
      timestamp: meeting.updatedAt,
      tone: 'danger',
    });
  }

  if (meeting.audioStatus === 'PROCESSING') {
    items.push({
      id: `audio-processing-${meeting.id}`,
      title: 'Bản ghi âm đang được publish',
      description: 'Raw audio đã có và hệ thống đang chuẩn bị player để phát lại trên giao diện.',
      timestamp: meeting.updatedAt,
      tone: 'warning',
    });
  }

  if (meeting.audioStatus === 'READY') {
    items.push({
      id: `audio-ready-${meeting.id}`,
      title: 'Bản ghi âm đã sẵn sàng',
      description: 'Bạn có thể phát lại audio full và nhảy tới từng mốc transcript.',
      timestamp: meeting.updatedAt,
      tone: 'success',
    });
  }

  if (meeting.summaryStatus === 'COMPLETED') {
    items.push({
      id: `summary-complete-${meeting.id}`,
      title: 'AI Notes đã tạo xong',
      description: `Tóm tắt, quyết định và việc cần làm đã được tổng hợp${meeting.summaryProvider ? ` bởi ${meeting.summaryProvider}` : ''}.`,
      timestamp: meeting.summaries[0]?.createdAt || meeting.updatedAt,
      tone: 'success',
    });
  }

  if (meeting.summaryStatus === 'FAILED') {
    items.push({
      id: `summary-failed-${meeting.id}`,
      title: 'AI Notes cần được tạo lại',
      description: meeting.summaryErrorText || 'Bản tổng hợp AI chưa hoàn tất. Bạn có thể thử tạo lại từ tab AI Notes.',
      timestamp: meeting.updatedAt,
      tone: 'danger',
    });
  }

  actionItems.forEach((item) => {
    const assigneeSummary = item.assignees.length
      ? item.assignees.map((assignee) => assignee.display_name || assignee.email).filter(Boolean).join(', ')
      : 'Chưa giao người phụ trách';
    const completedCount = item.assignees.filter((assignee) => assignee.status === 'COMPLETED').length;
    items.push({
      id: `action-${item.id}`,
      title:
        item.status === 'COMPLETED'
          ? `Hoàn tất việc: ${item.title}`
          : item.assignees.length > 0
            ? `Cập nhật phân công: ${item.title}`
            : `Backlog mới: ${item.title}`,
      description:
        item.assignees.length > 0
          ? `${assigneeSummary} · ${completedCount}/${item.assignees.length} đã xong`
          : 'Task đang chờ người phụ trách nhận việc.',
      timestamp: item.completed_at || item.updated_at || item.created_at,
      tone:
        item.status === 'COMPLETED'
          ? 'success'
          : item.assignees.length === 0
            ? 'warning'
            : 'info',
    });
  });

  return items
    .sort((left, right) => {
      const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : 0;
      const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 8);
};

const MeetingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [summaryLanguage, setSummaryLanguage] = useState<string>('vi');
  const [languageInitialized, setLanguageInitialized] = useState(false);
  const [isEditTitleOpen, setIsEditTitleOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportLanguage, setExportLanguage] = useState<ExportLanguage>('vi');
  const [exportLanguageInitialized, setExportLanguageInitialized] = useState(false);
  const [includeTranscriptAppendix, setIncludeTranscriptAppendix] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedTranscriptSpeaker, setSelectedTranscriptSpeaker] = useState('all');
  const [editingSpeakerLabel, setEditingSpeakerLabel] = useState<string | null>(null);
  const [speakerNameInput, setSpeakerNameInput] = useState('');
  const [newActionTitle, setNewActionTitle] = useState('');
  const [newActionAssigneeEmails, setNewActionAssigneeEmails] = useState<string[]>([]);
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [newActionPriority, setNewActionPriority] = useState('MEDIUM');
  const [isCreatingAction, setIsCreatingAction] = useState(false);
  const [isCreateExpanded, setIsCreateExpanded] = useState(false);
  const [showAdvancedCreateFields, setShowAdvancedCreateFields] = useState(false);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [actionEditDraft, setActionEditDraft] = useState<ActionEditDraft | null>(null);
  const [savingActionId, setSavingActionId] = useState<string | null>(null);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [activeTranscriptGroupId, setActiveTranscriptGroupId] = useState<string | null>(null);
  const [pendingTranscriptAnchor, setPendingTranscriptAnchor] = useState<TranscriptAnchor | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);

  useEffect(() => {
    const state = (location.state as { initialTab?: DetailTab; transcript_anchor?: TranscriptAnchor; transcriptAnchor?: TranscriptAnchor } | null);
    const initialTab = state?.initialTab;
    const anchor = state?.transcript_anchor || state?.transcriptAnchor;
    if (initialTab === 'actions' || initialTab === 'transcript') {
      setActiveTab(initialTab);
    }
    if (anchor) {
      setPendingTranscriptAnchor(anchor);
      setActiveTab('transcript');
    }
    if (initialTab || anchor) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const query = useQuery({
    queryKey: ['meeting-detail', id],
    enabled: Boolean(id),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    queryFn: async (): Promise<MeetingDetailType> => {
      const response = await api.get(`/api/meetings/${id}`);
      return normalizeMeetingDetail(response.data);
    },
  });

  const meeting = query.data;
  const selectedSummary = meeting?.summaries?.find((s) => s.language === summaryLanguage);
  const availableSummaryLanguages = new Set((meeting?.summaries || []).map((summary) => summary.language).filter(Boolean));
  const actionItems = meeting?.actionItems || [];

  const sectionLabels: Record<string, Record<string, string>> = {
    vi: { summary: 'Tóm tắt', keyPoints: 'Điểm chính', decisions: 'Quyết định',
      actions: 'Việc cần làm', risks: 'Rủi ro / điểm nghẽn', questions: 'Câu hỏi mở',
      timeline: 'Dòng thời gian nổi bật', speakers: 'Theo người nói',
      statusSuffix: 'điểm chính / quyết định / việc cần làm', meetingSummary: 'Tóm tắt cuộc họp',
      keyPointsDesc: 'Điểm chính thảo luận', decisionsDesc: 'Quyết định đã thống nhất' },
    en: { summary: 'Summary', keyPoints: 'Key Points', decisions: 'Decisions',
      actions: 'Action Items', risks: 'Risks / Bottlenecks', questions: 'Open Questions',
      timeline: 'Timeline Highlights', speakers: 'By Speaker',
      statusSuffix: 'key points / decisions / action items', meetingSummary: 'Meeting Summary',
      keyPointsDesc: 'Key Discussion Points', decisionsDesc: 'Decisions Agreed' },
    zh: { summary: '摘要', keyPoints: '要点', decisions: '决定',
      actions: '待办事项', risks: '风险 / 瓶颈', questions: '开放问题',
      timeline: '时间线亮点', speakers: '按发言人',
      statusSuffix: '要点 / 决定 / 待办事项', meetingSummary: '会议摘要',
      keyPointsDesc: '讨论要点', decisionsDesc: '已达成决定' },
    ja: { summary: '要約', keyPoints: '要点', decisions: '決定事項',
      actions: 'アクションアイテム', risks: 'リスク / ボトルネック', questions: '未解決の質問',
      timeline: 'タイムラインハイライト', speakers: '話者別',
      statusSuffix: '要点 / 決定事項 / アクションアイテム', meetingSummary: '会議要約',
      keyPointsDesc: '議論の要点', decisionsDesc: '合意された決定事項' },
    ko: { summary: '요약', keyPoints: '핵심 포인트', decisions: '결정 사항',
      actions: '할 일', risks: '위험 / 병목', questions: '미해결 질문',
      timeline: '타임라인 하이라이트', speakers: '발언자별',
      statusSuffix: '핵심 포인트 / 결정 사항 / 할 일', meetingSummary: '회의 요약',
      keyPointsDesc: '핵심 논의 포인트', decisionsDesc: '합의된 결정 사항' },
  };
  const L = sectionLabels[summaryLanguage] || sectionLabels.vi;

  const assigneeOptions = useMemo<ActionItemAssigneeOption[]>(() => {
    const options = new Map<string, ActionItemAssigneeOption>();
    meeting?.attendees.forEach((attendee) => {
      const email = attendee.email?.trim();
      if (!email || options.has(email)) return;
      options.set(email, {
        email,
        label: attendee.displayName || [attendee.firstName, attendee.lastName].filter(Boolean).join(' ') || attendee.username || email,
      });
    });
    if (meeting?.createdByUser?.email && !options.has(meeting.createdByUser.email)) {
      options.set(meeting.createdByUser.email, {
        email: meeting.createdByUser.email,
        label: meeting.createdByUser.displayName || meeting.createdByUser.username || meeting.createdByUser.email,
      });
    }
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [meeting]);

  // RSVP: fetch current user's invite status
  const [myInviteStatus, setMyInviteStatus] = useState<string | null>(null);
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [isRsvpLoading, setIsRsvpLoading] = useState(false);

  React.useEffect(() => {
    if (!id || !user) return;
    api.get(`/api/meetings/${id}/my-status`)
      .then((res) => {
        setMyInviteStatus(res.data.invite_status);
        setMyParticipantId(res.data.participant_id);
      })
      .catch(() => {});
  }, [id, user]);

  const handleRsvp = async (status: 'accepted' | 'declined') => {
    if (!myParticipantId) return;
    setIsRsvpLoading(true);
    try {
      await api.put(`/api/participants/${myParticipantId}/rsvp`, { invite_status: status });
      setMyInviteStatus(status);
    } catch {
      // silent
    } finally {
      setIsRsvpLoading(false);
    }
  };
  const keyPoints = (selectedSummary?.keyPoints as string[])?.length
    ? (selectedSummary.keyPoints as string[])
    : summaryLanguage === 'vi'
      ? (meeting?.keyPointsText?.length ? meeting.keyPointsText : meeting?.keyPoints || [])
      : [];
  const keyPointItems: AnchoredTextItem[] = meeting?.keyPointsItems?.length && summaryLanguage === 'vi'
    ? meeting.keyPointsItems
    : keyPoints.map((text) => ({ text }));
  const decisions = (selectedSummary?.decisions as string[])?.length
    ? (selectedSummary.decisions as string[])
    : summaryLanguage === 'vi'
      ? (meeting?.decisionsText?.length ? meeting.decisionsText : meeting?.decisions || [])
      : [];
  const decisionItems: AnchoredTextItem[] = meeting?.decisionsItems?.length && summaryLanguage === 'vi'
    ? meeting.decisionsItems
    : decisions.map((text) => ({ text }));
  const risks = (selectedSummary?.risks as string[])?.length
    ? (selectedSummary.risks as string[])
    : summaryLanguage === 'vi' ? (meeting?.risksText || []) : [];
  const openQuestions = (selectedSummary?.openQuestions as string[])?.length
    ? (selectedSummary.openQuestions as string[])
    : summaryLanguage === 'vi' ? (meeting?.openQuestionsText || []) : [];
  const timelineHighlights = (selectedSummary?.timelineHighlights as string[])?.length
    ? (selectedSummary.timelineHighlights as string[])
    : summaryLanguage === 'vi' ? (meeting?.timelineHighlightsText || []) : [];
  const timelineHighlightItems: AnchoredTextItem[] = meeting?.timelineHighlightsItems?.length && summaryLanguage === 'vi'
    ? meeting.timelineHighlightsItems
    : timelineHighlights.map((text) => ({ text }));
  const speakerSummaries = (selectedSummary?.speakerSummaries as string[])?.length
    ? (selectedSummary.speakerSummaries as string[])
    : summaryLanguage === 'vi' ? (meeting?.speakerSummariesText || []) : [];
  const transcript = useMemo(() => {
    if (!meeting) return '';
    return meeting.transcriptContent || meeting.transcripts[0]?.content || '';
  }, [meeting]);
  const transcriptSegments = meeting?.transcriptSegments || [];
  const transcriptGroups = useMemo(() => groupTranscriptSegments(transcriptSegments), [transcriptSegments]);
  const transcriptSpeakers = useMemo(
    () => Array.from(new Set(transcriptGroups.map((group) => group.speakerLabel))).sort(),
    [transcriptGroups],
  );
  const visibleTranscriptGroups = useMemo(
    () =>
      selectedTranscriptSpeaker === 'all'
        ? transcriptGroups
        : transcriptGroups.filter((group) => group.speakerLabel === selectedTranscriptSpeaker),
    [selectedTranscriptSpeaker, transcriptGroups],
  );
  const summary = selectedSummary?.meetingSummary
    || (summaryLanguage === 'vi' ? (meeting?.meetingSummaryText || meeting?.summary || '') : '');
  const summaryFailed = meeting?.summaryStatus === 'FAILED';
  const summaryErrorText = meeting?.summaryErrorText || 'AgentRouter không tạo được AI Notes. Kiểm tra token, model hoặc log backend.';
  const currentLanguage = meeting?.transcriptLanguage || summaryLanguage;
  const hasAiNotes = Boolean(
    summary ||
    keyPoints.length > 0 ||
    decisions.length > 0 ||
    risks.length > 0 ||
    openQuestions.length > 0 ||
    timelineHighlights.length > 0 ||
    speakerSummaries.length > 0 ||
    actionItems.length > 0,
  );
  const aiNotesStatusLabel = isRegenerating
    ? 'Đang tạo AI Notes'
    : summaryFailed
      ? 'Lỗi tạo AI Notes'
      : hasAiNotes
        ? 'AI Notes đã sẵn sàng'
        : 'Chưa có AI Notes';
  const transcriptStatusLabel = meeting?.transcriptStatus === 'COMPLETED'
    ? 'Transcript completed'
    : meeting?.transcriptStatus === 'DRAFT'
      ? 'Draft available'
      : meeting?.transcriptStatus === 'FAILED'
        ? 'Transcript failed'
        : 'Chưa có transcript';
  const formatSegmentTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  const hasMeetingAudio = Boolean(meeting?.audioUrl);
  const canReplayTranscript = hasMeetingAudio && isAudioReady;

  const selectTranscriptAnchor = async (anchor: TranscriptAnchor, autoplay = true) => {
    setActiveTab('transcript');
    const targetGroup = transcriptGroups.find((group) => {
      const groupContainsStart = anchor.start_time >= group.startTime && anchor.start_time <= Math.max(group.endTime, group.startTime + 0.25);
      const speakerMatches = !anchor.speaker_label || group.speakerLabel === anchor.speaker_label;
      return groupContainsStart && speakerMatches;
    }) || transcriptGroups.reduce<TranscriptGroup | null>((closest, group) => {
      if (!closest) return group;
      const currentDistance = Math.abs(group.startTime - anchor.start_time);
      const bestDistance = Math.abs(closest.startTime - anchor.start_time);
      return currentDistance < bestDistance ? group : closest;
    }, null);

    if (targetGroup) {
      setActiveTranscriptGroupId(targetGroup.id);
    }

    if (!hasMeetingAudio) {
      showToast.info('Cuộc họp này chưa có audio để phát lại.');
      return;
    }

    if (!isAudioReady || !audioPlayerRef.current) {
      return;
    }

    audioPlayerRef.current.seekTo(anchor.start_time);
    if (autoplay) {
      try {
        await audioPlayerRef.current.play();
      } catch {
        showToast.error('Không thể phát lại audio ở mốc này.');
      }
    }
  };

  useEffect(() => {
    if (!transcriptGroups.length) {
      setActiveTranscriptGroupId(null);
      return;
    }
    const activeGroup = transcriptGroups.find(
      (group) => currentAudioTime >= group.startTime && currentAudioTime <= Math.max(group.endTime, group.startTime + 0.25),
    );
    if (activeGroup) {
      setActiveTranscriptGroupId(activeGroup.id);
    } else if (!currentAudioTime) {
      setActiveTranscriptGroupId(null);
    }
  }, [currentAudioTime, transcriptGroups]);

  useEffect(() => {
    if (!pendingTranscriptAnchor || !transcriptGroups.length) return;
    void selectTranscriptAnchor(pendingTranscriptAnchor, true);
    setPendingTranscriptAnchor(null);
  }, [pendingTranscriptAnchor, transcriptGroups, isAudioReady, hasMeetingAudio]);

  useEffect(() => {
    setLanguageInitialized(false);
  }, [id]);

  useEffect(() => {
    if (!languageInitialized && meeting) {
      const preferredLanguage = meeting.summaries.some((summary) => summary.language === 'vi')
        ? 'vi'
        : meeting.summaries[0]?.language || meeting.transcriptLanguage || 'vi';
      setSummaryLanguage(preferredLanguage);
      setLanguageInitialized(true);
    }
  }, [meeting, languageInitialized]);

  useEffect(() => {
    if (!exportLanguageInitialized) {
      const nextLanguage = (meeting?.transcriptLanguage || meeting?.summaries?.[0]?.language || 'vi') as ExportLanguage;
      if (['vi', 'en', 'ja', 'zh', 'ko'].includes(nextLanguage)) {
        setExportLanguage(nextLanguage);
      }
      if (meeting?.transcriptLanguage || meeting?.summaries?.[0]?.language) {
        setExportLanguageInitialized(true);
      }
    }
  }, [meeting?.transcriptLanguage, meeting?.summaries, exportLanguageInitialized]);

  const nowMs = Date.now();
  const startMs = meeting ? new Date(meeting.startTime).getTime() : nowMs;
  const isUpcomingMeeting = meeting
    ? meeting.status === 'upcoming' || (startMs > nowMs && meeting.status !== 'completed')
    : false;
  const canManageMeeting = Boolean(
    meeting &&
      user &&
      user.systemRole !== 'viewer' &&
      (
        user.systemRole === 'system-admin' ||
        user.orgMemberships?.some((membership) => membership.orgId === meeting.organization_id && membership.role === 'org-admin') ||
        (meeting.group_id && user.groupMemberships?.some((membership) => membership.groupId === meeting.group_id && membership.role === 'group-admin')) ||
        meeting.createdBy === user.id
      ),
  );
  const isMeetingGroupAdmin = Boolean(
    meeting &&
      user &&
      (
        user.systemRole === 'system-admin' ||
        (meeting.group_id && user.groupMemberships?.some((membership) => membership.groupId === meeting.group_id && membership.role === 'group-admin'))
      ),
  );
  const isMeetingOrgAdmin = Boolean(
    meeting &&
      user &&
      (
        user.systemRole === 'system-admin' ||
        user.orgMemberships?.some((membership) => membership.orgId === meeting.organization_id && membership.role === 'org-admin')
      ),
  );
  const canManageActionItems = Boolean(meeting && (meeting.group_id ? isMeetingGroupAdmin : isMeetingOrgAdmin));
  const canJoinRoom = meeting?.status === 'upcoming' || meeting?.status === 'live';
  const isCurrentUserAssignee = (item: ActionItem) =>
    Boolean(
      user &&
        item.assignees.some(
          (assignee) =>
            assignee.user_id === user.id ||
            Boolean(
              user.email &&
                assignee.email &&
                assignee.email.toLowerCase() === user.email.toLowerCase(),
            ),
        ),
    );

  const handleRegenerateAINotes = async () => {
    if (!id || !transcript) return;
    setIsRegenerating(true);
    try {
      const response = await api.post(`/api/meetings/${id}/ai-notes/regenerate`, {
        transcript,
        segments: transcriptSegments.map((segment) => ({
          speaker: segment.speakerRawLabel || segment.speakerLabel,
          start: segment.startTime,
          end: segment.endTime,
          text: segment.text,
          language: segment.language,
          confidence: segment.confidenceScore,
        })),
        regenerate: true,
      });
      const result = response.data;
      if (result?.summary_status === "COMPLETED") {
        showToast.success("Đã tạo lại AI Notes cho tất cả ngôn ngữ!");
        query.refetch();
      } else {
        showToast.error("Tạo AI Notes thất bại. Kiểm tra log backend.");
      }
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, "Lỗi khi tạo lại AI Notes"));
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSaveSpeakerName = async () => {
    if (!id || !editingSpeakerLabel || !speakerNameInput.trim()) return;
    try {
      await api.patch(
        `/api/meetings/${id}/speaker-mappings/${encodeURIComponent(editingSpeakerLabel)}`,
        { display_name: speakerNameInput.trim() },
      );
      setEditingSpeakerLabel(null);
      setSpeakerNameInput('');
      await query.refetch();
      showToast.success("Đã cập nhật tên người nói");
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, "Không cập nhật được tên người nói"));
    }
  };

  const handleTranscriptGroupSelect = async (group: TranscriptGroup) => {
    if (!hasMeetingAudio) {
      showToast.info('Chưa có audio để phát lại.');
      return;
    }
    if (!isAudioReady || !audioPlayerRef.current) {
      showToast.info('Audio đang tải, vui lòng thử lại sau một chút.');
      return;
    }
    try {
      audioPlayerRef.current.seekTo(group.startTime);
      setActiveTranscriptGroupId(group.id);
      await audioPlayerRef.current.play();
    } catch {
      showToast.error('Không thể phát lại audio ở mốc này.');
    }
  };

  const filteredActionItems = useMemo(() => {
    const items = [...actionItems].filter((item) => {
      switch (actionFilter) {
        case 'mine':
          return isCurrentUserAssignee(item);
        case 'unassigned':
          return item.assignees.length === 0;
        case 'completed':
          return item.status === 'COMPLETED';
        default:
          return true;
      }
    });

    return items.sort((left, right) => {
      const leftDone = left.status === 'COMPLETED' ? 1 : 0;
      const rightDone = right.status === 'COMPLETED' ? 1 : 0;
      if (leftDone !== rightDone) return leftDone - rightDone;

      const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  }, [actionFilter, actionItems, user]);

  const actionFilterCounts = useMemo(
    () => ({
      all: actionItems.length,
      mine: actionItems.filter((item) => isCurrentUserAssignee(item)).length,
      unassigned: actionItems.filter((item) => item.assignees.length === 0).length,
      completed: actionItems.filter((item) => item.status === 'COMPLETED').length,
    }),
    [actionItems, user],
  );

  const actionEmptyText =
    actionItems.length === 0
      ? 'Chưa có việc cần làm nào trong cuộc họp này'
      : actionFilter === 'mine'
        ? 'Bạn chưa được giao việc nào ở cuộc họp này'
        : actionFilter === 'unassigned'
          ? 'Không còn việc nào chưa giao'
        : actionFilter === 'completed'
            ? 'Chưa có việc nào hoàn thành'
            : 'Không có việc cần làm phù hợp';
  const activityFeed = useMemo(
    () => (meeting?.activity?.length ? meeting.activity : buildMeetingActivityFeed(meeting, actionItems)),
    [actionItems, meeting],
  );
  const meetingQueryError = query.error as AxiosError<{ detail?: string }> | null;
  const meetingQueryStatus = meetingQueryError?.response?.status;
  const meetingErrorTitle =
    meetingQueryStatus === 403
      ? 'Bạn không có quyền truy cập'
      : meetingQueryStatus === 404
        ? 'Không tìm thấy cuộc họp'
        : 'Không tải được cuộc họp';
  const meetingErrorMessage =
    meetingQueryStatus === 403
      ? 'Bạn không có quyền xem cuộc họp này hoặc lời mời tham gia không còn hiệu lực.'
      : meetingQueryStatus === 404
        ? 'Cuộc họp này không tồn tại hoặc đã bị xóa.'
        : meetingQueryError?.response?.data?.detail || 'Đã có lỗi xảy ra khi tải dữ liệu cuộc họp. Vui lòng thử lại.';

  if (query.isLoading) {
    return (
      <PageState
        title="Đang tải chi tiết cuộc họp"
        description="Transcript, AI Notes, việc cần làm và bản ghi âm đang được đồng bộ."
        tone="loading"
      />
    );
  }

  if (query.isError || !meeting) {
    return (
      <PageState
        title={meetingErrorTitle}
        description={meetingErrorMessage}
        tone="error"
        action={(
          <button
            onClick={() => navigate('/meetings')}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 font-bold text-white transition hover:bg-primary-700"
          >
            <ArrowLeft size={18} />
            Quay lại danh sách
          </button>
        )}
      />
    );
  }

  const tabs: Array<{ key: DetailTab; label: string; icon: React.ReactNode }> = [
    { key: 'summary', label: L.summary, icon: <FileText size={16} /> },
    { key: 'transcript', label: 'Bản ghi', icon: <MessageSquare size={16} /> },
    { key: 'actions', label: L.actions, icon: <CheckCircle2 size={16} /> },
    { key: 'ai-notes', label: 'AI Notes', icon: <Sparkles size={16} /> },
  ];

  const handleEditMeeting = () => {
    setIsEditTitleOpen(true);
  };

  const handleSaveTitle = async (newTitle: string) => {
    try {
      await api.put(`/api/meetings/${meeting.id}`, { title: newTitle });
      query.refetch();
      setIsEditTitleOpen(false);
      showToast.success('Đã cập nhật tiêu đề');
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, 'Không thể cập nhật cuộc họp'));
    }
  };

  const handleDeleteMeeting = async () => {
    const confirmed = window.confirm(`Xoa cuoc hop "${meeting.title}"?`);
    if (!confirmed) return;
    try {
      await api.delete(`/api/meetings/${meeting.id}`);
      navigate('/meetings');
    } catch (err: unknown) {
      window.alert(getApiErrorDetail(err, 'Khong the xoa cuoc hop'));
    }
  };
  const handleExportMeeting = async () => {
    if (!meeting) return;
    setIsExporting(true);
    try {
      const res = await api.post('/api/export/generate', {
        meeting_id: meeting.id,
        format: exportFormat,
        language: exportLanguage,
        include_transcript_appendix: includeTranscriptAppendix,
        include_transcript: true,
        include_summary: true,
        include_action_items: true,
      });
      const blob = await api.get(res.data.download_url, { responseType: 'blob' });
      const url = window.URL.createObjectURL(blob.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.data.filename;
      a.click();
      window.URL.revokeObjectURL(url);
      setIsExportModalOpen(false);
      showToast.success('Đã tạo biên bản để tải xuống');
    } catch (err: unknown) {
      const axiosError = err as AxiosError<{ detail?: string }>;
      const status = axiosError.response?.status;
      const detail = axiosError.response?.data?.detail;
      const message =
        status === 404
          ? 'Không tìm thấy cuộc họp hoặc file export.'
          : status === 403
            ? 'Bạn không có quyền xuất biên bản cuộc họp này.'
            : detail || 'Xuất file thất bại. Vui lòng thử lại.';
      showToast.error(message);
    } finally {
      setIsExporting(false);
    }
  };
  const handleCreateActionItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!meeting || !newActionTitle.trim()) return;
    setIsCreatingAction(true);
    try {
      await api.post('/api/action-items', {
        meeting_id: meeting.id,
        title: newActionTitle.trim(),
        assignee_emails: newActionAssigneeEmails,
        due_date: newActionDueDate || undefined,
        priority: newActionPriority,
      });
      setNewActionTitle('');
      setNewActionAssigneeEmails([]);
      setNewActionDueDate('');
      setNewActionPriority('MEDIUM');
      setIsCreateExpanded(false);
      setShowAdvancedCreateFields(false);
      await query.refetch();
      showToast.success('Đã tạo việc cần làm');
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, 'Không thể tạo việc cần làm'));
    } finally {
      setIsCreatingAction(false);
    }
  };

  const handleUpdateActionItem = async (actionId: string, updates: Record<string, string | string[] | null>) => {
    try {
      await api.patch(`/api/action-items/${actionId}`, updates);
      await query.refetch();
      showToast.success('Đã cập nhật việc cần làm');
      return true;
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, 'Không thể cập nhật việc cần làm'));
      return false;
    }
  };

  const startEditActionItem = (item: ActionItem) => {
    setEditingActionId(item.id);
    setActionEditDraft({
      title: item.title,
      assignedEmails: item.assignees.map((assignee) => assignee.email).filter(Boolean),
      dueDate: item.due_date || '',
      status: item.status,
      priority: item.priority,
    });
  };

  const cancelEditActionItem = () => {
    setEditingActionId(null);
    setActionEditDraft(null);
  };

  const patchActionDraft = (updates: Partial<ActionEditDraft>) => {
    setActionEditDraft((draft) => draft ? { ...draft, ...updates } : draft);
  };

  const handleDeleteActionItem = async (item: ActionItem) => {
    const confirmed = window.confirm(`Xóa việc cần làm "${item.title}"?`);
    if (!confirmed) return;
    try {
      await api.delete(`/api/action-items/${item.id}`);
      if (editingActionId === item.id) {
        cancelEditActionItem();
      }
      if (expandedTaskId === item.id) {
        setExpandedTaskId(null);
      }
      await query.refetch();
      showToast.success('Đã xóa việc cần làm');
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, 'Không thể xóa việc cần làm'));
    }
  };

  const handleUpdateSelfActionStatus = async (item: ActionItem, status: ActionItem['status']) => {
    try {
      await api.patch(`/api/action-items/${item.id}/assignees/me`, { status });
      await query.refetch();
      showToast.success('Đã cập nhật tiến độ của bạn');
    } catch (err: unknown) {
      showToast.error(getApiErrorDetail(err, 'Không thể cập nhật tiến độ'));
    }
  };

  const confirmEditActionItem = async (item: ActionItem) => {
    if (!actionEditDraft || editingActionId !== item.id) return;
    const title = actionEditDraft.title.trim();
    if (!title) {
      showToast.error('Vui lòng nhập tiêu đề việc cần làm');
      return;
    }
    setSavingActionId(item.id);
    const ok = await handleUpdateActionItem(item.id, {
      title,
      priority: actionEditDraft.priority,
      assignee_emails: actionEditDraft.assignedEmails,
      due_date: actionEditDraft.dueDate || null,
    });
    setSavingActionId(null);
    if (ok) {
      cancelEditActionItem();
    }
  };

  return (
    <>
    <div className="mx-auto max-w-5xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="flex items-center justify-between">
          <nav className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-slate-400">
            <Link to="/meetings" className="transition hover:text-primary-600">Cuộc họp</Link>
            <span>/</span>
            {meeting.organization && (
              <>
                <span>{meeting.organization.name}</span>
                <span>/</span>
              </>
            )}
            {meeting.group && (
              <>
                <Link to={`/groups/${meeting.group.id}`} className="transition hover:text-primary-600">{meeting.group.name}</Link>
                <span>/</span>
              </>
            )}
            <span className="max-w-[150px] truncate font-bold text-gray-900 dark:text-slate-100">{meeting.title}</span>
          </nav>

          {meeting.isPinned && (
            <div className="rounded-xl border border-amber-200 p-2.5 text-amber-500">
              <Star size={18} fill="currentColor" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-black tracking-tight text-gray-900 dark:text-slate-100">{meeting.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-medium text-gray-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 dark:bg-slate-800">
                <Calendar size={14} />
                {format(new Date(meeting.startTime), 'dd/MM/yyyy')}
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 dark:bg-slate-800">
                <Clock size={14} />
                {meeting.duration} phut
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 dark:bg-slate-800">
                <Users size={14} />
                {meeting.attendees.length} nguoi tham gia
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canJoinRoom && (
              <button
                onClick={() => navigate(`/room/${meeting.code || meeting.id}`)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700"
              >
                <Sparkles size={16} />
                Vào phòng họp
              </button>
            )}
            {canManageMeeting && (
              <>
                <button
                  onClick={handleEditMeeting}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Pencil size={16} />
                  Sua
                </button>
              </>
            )}
            <button
              disabled={isUpcomingMeeting}
              onClick={() => setIsExportModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Download size={16} />
              Xuất biên bản
            </button>
            <button
              onClick={() => {
                const url = window.location.href;
                navigator.clipboard.writeText(url).then(() => {
                  alert('Đã sao chép liên kết!');
                }).catch(() => {
                  prompt('Sao chép liên kết:', url);
                });
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700"
            >
              <Share2 size={16} />
              Chia sẻ
            </button>
          </div>
        </div>
      </motion.div>

      {/* RSVP Banner */}
      {meeting && myInviteStatus === 'pending' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/30 dark:bg-amber-900/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-800 dark:text-amber-200">Bạn được mời tham gia cuộc họp này</h3>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Vui lòng xác nhận tham gia hoặc từ chối lời mời.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleRsvp('declined')}
                disabled={isRsvpLoading}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Từ chối
              </button>
              <button
                onClick={() => handleRsvp('accepted')}
                disabled={isRsvpLoading}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
              >
                Chấp nhận tham gia
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {meeting && myInviteStatus === 'accepted' && isUpcomingMeeting && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-900/10 dark:text-emerald-300">
          Bạn đã chấp nhận tham gia cuộc họp này
        </div>
      )}

      {meeting && myInviteStatus === 'declined' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
          Bạn đã từ chối tham gia cuộc họp này
        </div>
      )}

      {!isUpcomingMeeting && meeting?.audioStatus === 'FAILED' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
          Lỗi xử lý audio. Vui lòng liên hệ quản trị viên.
        </div>
      )}

      {!isUpcomingMeeting && meeting?.audioStatus === 'PROCESSING' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-300">
          Đang xử lý audio...
        </div>
      )}

      {!isUpcomingMeeting && meeting?.audioStatus === 'NONE' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold text-gray-500 dark:border-slate-800 dark:bg-slate-900/10 dark:text-slate-400">
          Cuộc họp này chưa có audio để phát lại.
        </div>
      )}

      {!isUpcomingMeeting && meeting?.audioStatus === 'READY' && meeting.audioUrl && (
        <AudioPlayer
          ref={audioPlayerRef}
          src={meeting.audioUrl}
          onTimeUpdate={setCurrentAudioTime}
          onReady={setIsAudioReady}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isUpcomingMeeting ? (
            <div className="rounded-3xl border border-blue-200 bg-blue-50/40 p-8 shadow-sm dark:border-blue-900/30 dark:bg-blue-900/10">
              <h3 className="text-xl font-black text-blue-900 dark:text-blue-200">Cuộc họp sắp tới</h3>
              <p className="mt-3 text-sm leading-relaxed text-blue-800 dark:text-blue-300">
                Cuộc họp này chưa diễn ra nên chưa có bản ghi, tóm tắt AI và việc cần làm.
                Sau khi họp kết thúc và hệ thống xử lý xong, các nội dung này sẽ tự động xuất hiện tại đây.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-blue-700 dark:text-blue-300">
                <span className="rounded-full bg-white/70 px-3 py-1 dark:bg-slate-900/40">Trạng thái: Sắp tới</span>
                <span className="rounded-full bg-white/70 px-3 py-1 dark:bg-slate-900/40">
                  Bắt đầu: {format(new Date(meeting.startTime), 'HH:mm dd/MM/yyyy')}
                </span>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex border-b border-gray-100 bg-gray-50/50 px-2 dark:border-slate-800 dark:bg-slate-800/50">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-bold transition-all ${
                      activeTab === tab.key
                        ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                        : 'border-transparent text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-8">
                <AnimatePresence mode="wait">
                  {activeTab === 'summary' && (
                    <motion.div key="summary" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-8">
                      <section>
                        <h3 className="mb-4 text-lg font-black text-gray-900 dark:text-slate-100">{L.meetingSummary}</h3>
                        <div className="rounded-2xl border border-primary-100 bg-primary-50/30 p-6 leading-relaxed text-gray-800 dark:border-primary-900/20 dark:bg-primary-900/10 dark:text-slate-300">
                          {summary || 'Chưa có tóm tắt cho cuộc họp này.'}
                        </div>
                      </section>

                      {keyPoints.length > 0 && (
                        <section>
                          <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-gray-900 dark:text-slate-100">
                            <Key size={20} className="text-blue-500" />
                            {L.keyPointsDesc}
                          </h3>
                          <div className="grid gap-3">
                            {keyPointItems.map((point, index) => (
                              <div key={`${point.text}-${index}`} className="flex items-start gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-slate-300">{point.text}</p>
                                  {point.anchor && (
                                    <button
                                      type="button"
                                      onClick={() => void selectTranscriptAnchor(point.anchor!, true)}
                                      className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-600 transition hover:text-violet-700"
                                    >
                                      Nghe lại đoạn này
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {decisions.length > 0 && (
                        <section>
                          <h3 className="mb-4 flex items-center gap-2 text-lg font-black text-gray-900 dark:text-slate-100">
                            <Target size={20} className="text-green-500" />
                            {L.decisionsDesc}
                          </h3>
                          <div className="space-y-3">
                            {decisionItems.map((decision, index) => (
                              <div key={`${decision.text}-${index}`} className="flex items-start gap-3 rounded-xl border border-green-100 bg-green-50/30 p-4 dark:border-green-900/20 dark:bg-green-900/10">
                                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-green-900 dark:text-green-100">{decision.text}</p>
                                  {decision.anchor && (
                                    <button
                                      type="button"
                                      onClick={() => void selectTranscriptAnchor(decision.anchor!, true)}
                                      className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-600 transition hover:text-violet-700"
                                    >
                                      Nghe lại đoạn này
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'transcript' && (
                    <motion.div key="transcript" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Bản ghi chi tiết</h3>
                          <p className="mt-1 text-xs font-bold text-gray-500 dark:text-slate-400">
                            {transcriptGroups.length > 0
                              ? `${visibleTranscriptGroups.length}/${transcriptGroups.length} lượt nói`
                              : 'Timeline cuộc họp'}
                          </p>
                          <p className="mt-2 text-[11px] font-black uppercase tracking-widest text-primary-600 dark:text-primary-300">
                            {transcriptStatusLabel}
                          </p>
                          <p className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                            Bấm vào một đoạn để nghe lại từ mốc này.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {transcriptSpeakers.length > 1 && (
                            <select
                              value={selectedTranscriptSpeaker}
                              onChange={(event) => setSelectedTranscriptSpeaker(event.target.value)}
                              className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none transition focus:border-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                              <option value="all">Tất cả người nói</option>
                              {transcriptSpeakers.map((speaker) => (
                                <option key={speaker} value={speaker}>
                                  {speaker}
                                </option>
                              ))}
                            </select>
                          )}
                          {meeting.transcriptUrl && (
                            <a href={meeting.transcriptUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-primary-600 hover:text-primary-700">
                              Tải bản ghi
                            </a>
                          )}
                        </div>
                      </div>
                      {visibleTranscriptGroups.length > 0 ? (
                        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-2">
                          {visibleTranscriptGroups.map((group) => (
                            <div
                              key={group.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => void handleTranscriptGroupSelect(group)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  void handleTranscriptGroupSelect(group);
                                }
                              }}
                              className={`rounded-2xl border p-5 transition ${
                                activeTranscriptGroupId === group.id
                                  ? 'border-primary-200 bg-primary-50/60 shadow-sm dark:border-primary-900/30 dark:bg-primary-900/10'
                                  : canReplayTranscript
                                    ? 'cursor-pointer border-gray-100 bg-gray-50 hover:border-primary-200 hover:bg-primary-50/40 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-primary-900/30 dark:hover:bg-primary-900/10'
                                    : 'cursor-not-allowed border-gray-100 bg-gray-50/80 opacity-80 dark:border-slate-800 dark:bg-slate-800/50'
                              }`}
                              aria-disabled={!canReplayTranscript}
                            >
                              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500 dark:text-slate-400">
                                <span className={`rounded-full px-2.5 py-1 dark:bg-slate-900 ${activeTranscriptGroupId === group.id ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200' : 'bg-white'}`}>
                                  {formatSegmentTime(group.startTime)}
                                </span>
                                <span className="text-gray-800 dark:text-slate-200">{group.speakerLabel}</span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingSpeakerLabel(group.speakerRawLabel);
                                    setSpeakerNameInput(group.speakerLabel);
                                  }}
                                  className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-primary-50 hover:text-primary-700 dark:bg-slate-900 dark:text-slate-400"
                                >
                                  Đổi tên
                                </button>
                                {group.languages.map((language) => (
                                  <span key={language} className="rounded-full bg-primary-50 px-2 py-1 uppercase text-primary-700 dark:bg-primary-900/20 dark:text-primary-300">
                                    {language}
                                  </span>
                                ))}
                              </div>
                              <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700 dark:text-slate-300">
                                {group.texts.join(' ')}
                              </p>
                              {group.corrections.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {group.corrections
                                    .map((c, idx) => (
                                      <span
                                        key={idx}
                                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800"
                                        title={`"${c.wrong}" → "${c.right}"`}
                                      >
                                        {c.wrong} → {c.right}
                                      </span>
                                    ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : transcriptGroups.length > 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/30">
                          <MessageSquare size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                          <p className="text-sm font-bold text-gray-500 dark:text-slate-400">Không có bản ghi của người nói này</p>
                        </div>
                      ) : transcript ? (
                        <div className="max-h-[68vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-gray-100 bg-gray-50 p-6 pr-4 text-sm leading-7 text-gray-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                          {transcript}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/30">
                          <MessageSquare size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                          <p className="text-sm font-bold text-gray-500 dark:text-slate-400">Chưa có bản ghi cho cuộc họp này</p>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'actions' && (
                    <motion.div key="actions" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                      {/* Clean Header & Filters */}
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between px-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-xl font-black text-gray-900 tracking-tight">{L.actions}</h3>
                          <span className="flex h-6 min-w-[24px] items-center justify-center rounded-lg bg-gray-100 px-2 text-[11px] font-black text-gray-500 shadow-inner">
                            {actionItems.length}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Segmented Filter Control */}
                          <div className="inline-flex items-center gap-0.5 rounded-xl border border-gray-100 bg-gray-50/50 p-1">
                            {[
                              { key: 'all' as const, label: 'Tất cả', count: actionFilterCounts.all },
                              { key: 'mine' as const, label: 'Của tôi', count: actionFilterCounts.mine },
                              { key: 'unassigned' as const, label: 'Chưa giao', count: actionFilterCounts.unassigned },
                              { key: 'completed' as const, label: 'Xong', count: actionFilterCounts.completed },
                            ].map((filter) => (
                              <button
                                key={filter.key}
                                type="button"
                                onClick={() => setActionFilter(filter.key)}
                                className={`relative rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition-all ${
                                  actionFilter === filter.key
                                    ? 'bg-white text-primary-600 shadow-sm ring-1 ring-black/5'
                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                                }`}
                              >
                                {filter.label}
                                {filter.count > 0 && actionFilter !== filter.key && (
                                  <span className="ml-1 opacity-50">({filter.count})</span>
                                )}
                              </button>
                            ))}
                          </div>

                          <button className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-100 bg-white text-gray-400 transition hover:bg-gray-50 hover:text-gray-900 shadow-sm">
                            <ArrowDownWideNarrow size={16} />
                          </button>
                        </div>
                      </div>

                      <ActionItemComposer
                        canManage={canManageActionItems}
                        title={newActionTitle}
                        onTitleChange={setNewActionTitle}
                        assigneeOptions={assigneeOptions}
                        selectedAssignees={newActionAssigneeEmails}
                        onSelectedAssigneesChange={setNewActionAssigneeEmails}
                        dueDate={newActionDueDate}
                        onDueDateChange={setNewActionDueDate}
                        priority={newActionPriority as ActionItem['priority']}
                        onPriorityChange={(value) => setNewActionPriority(value)}
                        isExpanded={isCreateExpanded}
                        onExpandedChange={setIsCreateExpanded}
                        showAdvanced={showAdvancedCreateFields}
                        onShowAdvancedChange={setShowAdvancedCreateFields}
                        isSubmitting={isCreatingAction}
                        onSubmit={handleCreateActionItem}
                      />

                      {filteredActionItems.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/30">
                          <CheckCircle2 size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                          <p className="text-sm font-bold text-gray-500 dark:text-slate-400">{actionEmptyText}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {filteredActionItems.map((item) => (
                            <MeetingActionItemCard
                              key={item.id}
                              item={item}
                              currentUser={user}
                              assigneeOptions={assigneeOptions}
                              canManage={canManageActionItems}
                              isCurrentUserAssignee={isCurrentUserAssignee(item)}
                              isEditing={editingActionId === item.id}
                              isSaving={savingActionId === item.id}
                              draft={editingActionId === item.id ? actionEditDraft : null}
                              expanded={expandedTaskId === item.id}
                              onToggleExpanded={() => setExpandedTaskId((current) => (current === item.id ? null : item.id))}
                              onStartEdit={() => startEditActionItem(item)}
                              onCancelEdit={cancelEditActionItem}
                              onPatchDraft={patchActionDraft}
                              onConfirmEdit={() => confirmEditActionItem(item)}
                              onDelete={() => handleDeleteActionItem(item)}
                              onUpdateSelfStatus={(status) => handleUpdateSelfActionStatus(item, status)}
                              onJumpToContext={item.anchor ? () => void selectTranscriptAnchor(item.anchor!, true) : undefined}
                            />
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'ai-notes' && (
                    <motion.div key="ai-notes" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="space-y-6">
                      <div>
                        <h3 className="flex items-center gap-2 text-lg font-black text-gray-900 dark:text-slate-100">
                          <Sparkles size={20} className="text-primary-500" />
                          AI Notes
                        </h3>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
                          {transcriptStatusLabel} / {aiNotesStatusLabel} / {currentLanguage || 'vi'} / {keyPoints.length} {L.keyPoints} / {decisions.length} {L.decisions} / {actionItems.length} {L.actions}
                        </p>
                      </div>

                      {summaryFailed && (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                          <div className="flex items-start gap-3">
                            <AlertCircle size={20} className="mt-0.5 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-black uppercase tracking-widest">AI Notes đang lỗi</p>
                              <p className="mt-2 text-sm leading-6">{summaryErrorText}</p>
                              {(meeting.summaryProvider || meeting.summaryModelName) && (
                                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-red-500 dark:text-red-300">
                                  {meeting.summaryProvider || 'router'} / {meeting.summaryModelName || 'unknown-model'}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Language Viewer + Regenerate All Button */}
                      {transcript && (
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-widest text-gray-400 dark:text-slate-500">Xem ngôn ngữ</span>
                            <select
                              value={summaryLanguage}
                              onChange={(e) => setSummaryLanguage(e.target.value)}
                              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            >
                              {SUPPORTED_MEETING_LANGUAGES.map((language) => (
                                <option key={language.code} value={language.code}>
                                  {language.label}
                                </option>
                              ))}
                            </select>
                            <div className="flex flex-wrap gap-1.5">
                              {SUPPORTED_MEETING_LANGUAGES.map((language) => (
                                <span
                                  key={language.code}
                                  className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                                    availableSummaryLanguages.has(language.code)
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                      : 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500'
                                  }`}
                                >
                                  {language.code}
                                </span>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={handleRegenerateAINotes}
                            disabled={isRegenerating}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-sm font-black text-white transition hover:from-indigo-500 hover:to-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
                            {isRegenerating ? "Đang tạo AI Notes cho 5 ngôn ngữ..." : summaryFailed ? "Thử lại AI Notes cho tất cả ngôn ngữ" : "Tạo lại AI Notes cho tất cả ngôn ngữ"}
                          </button>
                        </div>
                      )}

                      {!hasAiNotes ? (
                        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center dark:border-slate-700 dark:bg-slate-800/30">
                          <Sparkles size={32} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                          <p className="text-sm font-bold text-gray-500 dark:text-slate-400">
                            {summaryFailed ? 'Transcript đã lưu, nhưng AI Notes chưa tạo được.' : 'Chưa có AI Notes cho cuộc họp này.'}
                          </p>
                        </div>
                      ) : (
                        <>
                          {summary && (
                            <section className="rounded-2xl border border-primary-100 bg-primary-50/30 p-5 dark:border-primary-900/20 dark:bg-primary-900/10">
                              <h4 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-primary-700 dark:text-primary-300">
                                <FileText size={16} />
                                {L.summary}
                              </h4>
                              <p className="max-w-3xl whitespace-pre-line text-sm leading-7 text-gray-800 dark:text-slate-300">{summary}</p>
                            </section>
                          )}

                          {keyPoints.length > 0 && (
                            <section className="space-y-3">
                              <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">
                                <Key size={16} />
                                {L.keyPoints}
                              </h4>
                              {keyPointItems.map((point, index) => (
                                <div key={`${point.text}-${index}`} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                    {index + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-slate-300">{point.text}</p>
                                    {point.anchor && (
                                      <button
                                        type="button"
                                        onClick={() => void selectTranscriptAnchor(point.anchor!, true)}
                                        className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-600 transition hover:text-violet-700"
                                      >
                                        Nghe lại đoạn này
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </section>
                          )}

                          {decisions.length > 0 && (
                            <section className="space-y-3">
                              <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
                                <Target size={16} />
                                {L.decisions}
                              </h4>
                              {decisionItems.map((decision, index) => (
                                <div key={`${decision.text}-${index}`} className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 dark:border-emerald-900/20 dark:bg-emerald-900/10">
                                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold leading-relaxed text-emerald-900 dark:text-emerald-100">{decision.text}</p>
                                    {decision.anchor && (
                                      <button
                                        type="button"
                                        onClick={() => void selectTranscriptAnchor(decision.anchor!, true)}
                                        className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-600 transition hover:text-violet-700"
                                      >
                                        Nghe lại đoạn này
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </section>
                          )}

                          {timelineHighlights.length > 0 && (
                            <section className="space-y-3">
                              <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-violet-600 dark:text-violet-300">
                                <Clock size={16} />
                                {L.timeline}
                              </h4>
                              {timelineHighlightItems.map((highlight, index) => (
                                <div key={`${highlight.text}-${index}`} className="flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4 dark:border-violet-900/20 dark:bg-violet-900/10">
                                  <span className="mt-0.5 text-xs font-black text-violet-600 dark:text-violet-300">{String(index + 1).padStart(2, '0')}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-slate-300">{highlight.text}</p>
                                    {highlight.anchor && (
                                      <button
                                        type="button"
                                        onClick={() => void selectTranscriptAnchor(highlight.anchor!, true)}
                                        className="mt-2 text-[10px] font-black uppercase tracking-widest text-violet-600 transition hover:text-violet-700"
                                      >
                                        Nghe lại đoạn này
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </section>
                          )}

                          {speakerSummaries.length > 0 && (
                            <section className="space-y-3">
                              <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-sky-600 dark:text-sky-300">
                                <Users size={16} />
                                {L.speakers}
                              </h4>
                              {speakerSummaries.map((item, index) => (
                                <div key={`${item}-${index}`} className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 dark:border-sky-900/20 dark:bg-sky-900/10">
                                  <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-slate-300">{item}</p>
                                </div>
                              ))}
                            </section>
                          )}

                          {(risks.length > 0 || openQuestions.length > 0) && (
                            <section className="grid gap-4 md:grid-cols-2">
                              {risks.length > 0 && (
                                <div className="space-y-3">
                                  <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-red-600 dark:text-red-300">
                                    <AlertCircle size={16} />
                                    {L.risks}
                                  </h4>
                                  {risks.map((risk, index) => (
                                    <div key={`${risk}-${index}`} className="rounded-xl border border-red-100 bg-red-50/40 p-4 dark:border-red-900/20 dark:bg-red-900/10">
                                      <p className="text-sm font-medium leading-relaxed text-red-900 dark:text-red-100">{risk}</p>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {openQuestions.length > 0 && (
                                <div className="space-y-3">
                                  <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-orange-600 dark:text-orange-300">
                                    <MessageSquare size={16} />
                                    {L.questions}
                                  </h4>
                                  {openQuestions.map((question, index) => (
                                    <div key={`${question}-${index}`} className="rounded-xl border border-orange-100 bg-orange-50/40 p-4 dark:border-orange-900/20 dark:bg-orange-900/10">
                                      <p className="text-sm font-medium leading-relaxed text-orange-900 dark:text-orange-100">{question}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </section>
                          )}

                          {actionItems.length > 0 && (
                            <section className="space-y-3">
                              <h4 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-amber-600 dark:text-amber-300">
                                <CheckCircle2 size={16} />
                                {L.actions}
                              </h4>
                              {actionItems.map((item) => (
                                <div key={item.id} className="rounded-xl border border-gray-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm font-bold text-gray-900 dark:text-slate-100">{item.title}</p>
                                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                      {item.status}
                                    </span>
                                  </div>
                                  {item.assignees.length > 0 && (
                                    <p className="mt-2 text-xs font-semibold text-gray-500 dark:text-slate-400">
                                      {item.assignees.map((assignee) => assignee.display_name || assignee.email).join(', ')}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </section>
                          )}
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Nguoi tao</h3>
            <p className="mt-3 font-bold text-gray-900 dark:text-slate-100">
              {meeting.createdByUser?.displayName || meeting.createdByUser?.email || 'Không xác định'}
            </p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Ngữ cảnh</h3>
            <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-slate-300">
              <p>Tổ chức: {meeting.organization?.name || 'Chưa có'}</p>
              <p>Nhóm: {meeting.group?.name || 'Nhóm chung'}</p>
              <p>Trạng thái: {meeting.status}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Trạng thái xử lý</h3>
            <div className="mt-4 space-y-3 text-sm">
              {[
                {
                  label: 'Transcript',
                  value: transcriptStatusLabel,
                  tone:
                    meeting.transcriptStatus === 'COMPLETED'
                      ? 'text-emerald-600'
                      : meeting.transcriptStatus === 'FAILED'
                        ? 'text-red-600'
                        : 'text-blue-600',
                },
                {
                  label: 'Audio',
                  value:
                    meeting.audioStatus === 'READY'
                      ? 'Audio player đã sẵn sàng'
                      : meeting.audioStatus === 'PROCESSING'
                        ? 'Đang chuẩn bị bản ghi âm'
                        : meeting.audioStatus === 'FAILED'
                          ? 'Audio publish lỗi'
                          : 'Chưa có audio',
                  tone:
                    meeting.audioStatus === 'READY'
                      ? 'text-emerald-600'
                      : meeting.audioStatus === 'FAILED'
                        ? 'text-red-600'
                        : 'text-amber-600',
                },
                {
                  label: 'AI Notes',
                  value: aiNotesStatusLabel,
                  tone:
                    meeting.summaryStatus === 'COMPLETED'
                      ? 'text-emerald-600'
                      : meeting.summaryStatus === 'FAILED'
                        ? 'text-red-600'
                        : 'text-amber-600',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400 dark:text-slate-500">{item.label}</span>
                  <span className={`text-right text-xs font-bold ${item.tone} dark:text-inherit`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-widest text-gray-400">Hoạt động gần đây</h3>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-500 dark:bg-slate-800 dark:text-slate-400">
                {activityFeed.length}
              </span>
            </div>
            {activityFeed.length > 0 ? (
              <div className="mt-4 space-y-3">
                {activityFeed.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-gray-900 dark:text-slate-100">{item.title}</p>
                      <span
                        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          item.tone === 'success'
                            ? 'bg-emerald-500'
                            : item.tone === 'warning'
                              ? 'bg-amber-500'
                              : item.tone === 'danger'
                                ? 'bg-red-500'
                                : item.tone === 'info'
                                  ? 'bg-blue-500'
                                  : 'bg-gray-400'
                        }`}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-6 text-gray-600 dark:text-slate-300">{item.description}</p>
                    <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
                      {formatTimelineDate(item.timestamp)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                Hoạt động cộng tác sẽ hiện ở đây khi transcript, audio, AI Notes hoặc việc cần làm được cập nhật.
              </div>
            )}
          </div>

          {canManageMeeting && (
            <div className="rounded-3xl border border-red-200 bg-red-50/70 p-6 shadow-sm dark:border-red-900/30 dark:bg-red-950/10">
              <h3 className="text-sm font-black uppercase tracking-widest text-red-500 dark:text-red-300">
                Vùng nguy hiểm
              </h3>
              <p className="mt-3 text-sm leading-6 text-red-700 dark:text-red-200">
                Xóa cuộc họp sẽ làm bạn rời khỏi trang chi tiết này và không thể hoàn tác từ giao diện.
              </p>
              <button
                onClick={handleDeleteMeeting}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/20"
              >
                <Trash2 size={16} />
                Xóa cuộc họp này
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
    {editingSpeakerLabel && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <h3 className="text-lg font-black text-gray-900 dark:text-slate-100">Đổi tên người nói</h3>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            Label gốc: <span className="font-bold">{editingSpeakerLabel}</span>
          </p>
          <input
            value={speakerNameInput}
            onChange={(event) => setSpeakerNameInput(event.target.value)}
            autoFocus
            className="mt-5 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-primary-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="Ví dụ: Huyền"
          />
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditingSpeakerLabel(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 dark:border-slate-700 dark:text-slate-300"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSaveSpeakerName}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white hover:bg-primary-700"
            >
              Lưu tên
            </button>
          </div>
        </div>
      </div>
    )}
    <EditTitleModal
      isOpen={isEditTitleOpen}
      currentTitle={meeting.title}
      onClose={() => setIsEditTitleOpen(false)}
      onSave={handleSaveTitle}
    />
    <Modal
      isOpen={isExportModalOpen}
      onClose={() => !isExporting && setIsExportModalOpen(false)}
      title="Xuất biên bản cuộc họp"
      subtitle="Chọn định dạng, ngôn ngữ và cách đính kèm transcript."
      size="md"
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-xs font-black uppercase tracking-widest text-gray-400">Định dạng</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { value: 'pdf', label: 'PDF', desc: 'Phù hợp để in và gửi ngay' },
              { value: 'docx', label: 'DOCX', desc: 'Dễ chỉnh sửa sau khi tải' },
            ] as Array<{ value: ExportFormat; label: string; desc: string }>).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setExportFormat(option.value)}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  exportFormat === option.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-200'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <p className="text-sm font-black">{option.label}</p>
                <p className="mt-1 text-xs leading-5 opacity-80">{option.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-black uppercase tracking-widest text-gray-400" htmlFor="export-language">
            Ngôn ngữ biên bản
          </label>
          <select
            id="export-language"
            value={exportLanguage}
            onChange={(event) => setExportLanguage(event.target.value as ExportLanguage)}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 outline-none transition focus:border-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
            <option value="ko">한국어</option>
          </select>
          <p className="text-xs leading-5 text-gray-500 dark:text-slate-400">
            Hệ thống ưu tiên nội dung đúng ngôn ngữ đã chọn, nếu thiếu sẽ fallback sang dữ liệu hiện có.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
          <input
            type="checkbox"
            checked={includeTranscriptAppendix}
            onChange={(event) => setIncludeTranscriptAppendix(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <div>
            <p className="text-sm font-bold text-gray-800 dark:text-slate-100">Đính kèm phụ lục transcript</p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-slate-400">
              Transcript toàn văn sẽ được đưa xuống phần phụ lục, không chen vào thân chính của biên bản.
            </p>
          </div>
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setIsExportModalOpen(false)}
            disabled={isExporting}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => void handleExportMeeting()}
            disabled={isExporting || !meeting}
            className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {isExporting ? 'Đang tạo biên bản...' : 'Tải xuống'}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
};

export default MeetingDetail;
