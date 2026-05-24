/**
 * MeetingRoom v3.1 - Enhanced Device Management & Refined Sidebar
 * Ensures hardware release on camera toggle and premium sidebar experience.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  LogOut,
  MonitorUp,
  MessageSquare,
  Users,
  Check,
  UserPlus,
  Send,
  X,
  FileText,
  ListChecks,
  Target,
  Sparkles,
  LayoutGrid,
  Maximize2,
  MoreVertical,
  Volume2,
  ShieldCheck,
  Settings
} from "lucide-react";
import { PageState, showToast } from "../components/ui";
import { useWebSocket, useAudioRecorder } from "../hooks";
import { useAuth } from "../context/AuthContext";
import { useAppStore } from "../stores";
import { clsx } from "clsx";
import api from "../services/api";
import { normalizeMeetingDetail, normalizeMeetingMessage } from "../services/mappers";
import type { MeetingDetail, MeetingMessage } from "../types";
import {
  aiNotesFromMeeting,
  dedupeActionItems,
  normalizeParticipantRole,
  normalizeRoomTranscriptChunk,
  type ParticipantRole,
  type RoomTranscriptChunk,
} from "../features/meeting-room/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  stream?: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  handRaised: boolean;
  isSpeaking?: boolean;
}

type SidePanel = "chat" | "participants" | "ai-notes" | null;

// ─── Mock Data ───────────────────────────────────────────────────────────────

const WAVEFORM_HEIGHTS = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map(() => Math.random() * 40 + 10);

// ─── Helper Components ───────────────────────────────────────────────────────

/**
 * Specialized Video Component to prevent flickering/jitter
 * Ensures srcObject is only assigned when the stream actually changes
 */
const VideoView: React.FC<{ 
  stream: MediaStream | null; 
  muted?: boolean; 
  mirror?: boolean;
  className?: string;
  objectFit?: 'cover' | 'contain';
}> = ({ stream, muted = false, mirror = false, className = "", objectFit = 'cover' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      if (stream) {
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.log("Video play error:", e));
        }
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={clsx("h-full w-full", className, objectFit === 'cover' ? 'object-cover' : 'object-contain')}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
};

/**
 * Isolated Timer component to prevent re-rendering the whole MeetingRoom
 */
const RecordingTimer: React.FC<{ isRecording: boolean }> = ({ isRecording }) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (isRecording) {
      const interval = setInterval(() => setSeconds(s => s + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [isRecording]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-xs font-black font-mono text-red-400">REC {formatTime(seconds)}</span>
    </div>
  );
};

// ─── Error Boundary ─────────────────────────────────────────────────────────

class MeetingRoomErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("MeetingRoom Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617] text-white">
          <div className="text-center p-8">
            <h2 className="text-xl font-bold mb-4">Lỗi tải phòng họp</h2>
            <p className="text-slate-400 mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-indigo-600 rounded-xl hover:bg-indigo-700"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

const MeetingRoomInner: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const { meetings } = useAppStore();
  const roomState = (location.state || {}) as {
    enableCamera?: boolean;
    enableMic?: boolean;
    enableRecord?: boolean;
  };
  const [remoteMeeting, setRemoteMeeting] = useState<MeetingDetail | null>(null);
  const [isMeetingLoading, setIsMeetingLoading] = useState(true);
  const [meetingLoadError, setMeetingLoadError] = useState<string | null>(null);
  
  const meeting = useMemo(() => {
    if (!code) return null;
    return remoteMeeting || (meetings as any[]).find(m => m.code === code || m.id === code) || null;
  }, [code, meetings, remoteMeeting]);

  const isOrganizer = meeting?.createdBy === user?.id;
  const isMeetingGuest = meeting?.accessMode === "meeting_guest";

  const [isRecording] = useState(roomState.enableRecord !== false);
  const [micOn, setMicOn] = useState(roomState.enableMic !== false);
  const [cameraOn, setCameraOn] = useState(roomState.enableCamera !== false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>("ai-notes");
  const [chatMessages, setChatMessages] = useState<MeetingMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [snapshotTranscripts, setSnapshotTranscripts] = useState<RoomTranscriptChunk[]>([]);
  const [remoteInterims, setRemoteInterims] = useState<Record<string, any>>({});
  const [aiNotes, setAiNotes] = useState<any | null>(null);
  const [aiNotesStatus, setAiNotesStatus] = useState<string | null>(remoteMeeting?.summaryStatus || null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mainView, setMainView] = useState<"camera" | "screen">("camera");
  
  const [remoteParticipants, setRemoteParticipants] = useState<Participant[]>([]);
  const selfParticipantId = user?.id || "me";
  const [spotlightId, setSpotlightId] = useState<string>(selfParticipantId);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { transcript: wsTranscripts, lastEvent: wsEvent, status: wsStatus, connect, sendJson, disconnect, isConnected, onReconnect } = useWebSocket();

  // Audio Recorder - PhoWhisper STT
  const meetingId = meeting?.id || null;
  const {
    isRecording: isAudioRecording,
    liveTranscripts,
    fullTranscript,
    allSegments,
    interimTranscript,
    sttStatus,
    startRecording,
    stopRecording,
    finalize,
    hydrateDraft,
    error: recorderError,
  } = useAudioRecorder(localStream, meetingId);

  const selfParticipant = useMemo<Participant>(() => ({
    id: selfParticipantId,
    name: user?.displayName || user?.email?.split('@')[0] || "Bạn",
    role: isOrganizer ? "organizer" : "attendee",
    stream: localStream,
    micOn,
    cameraOn,
    handRaised: false,
  }), [cameraOn, isOrganizer, localStream, micOn, selfParticipantId, user?.displayName, user?.email]);

  const mapOnlineParticipants = useCallback((onlineRows: any[], participantRows: any[] = []): Participant[] => {
    const byId = new Map<string, Participant>();
    onlineRows.forEach((onlineRow: any) => {
      const id = String(onlineRow?.user_id || onlineRow?.id || onlineRow?.participant_id || "");
      if (!id || id === selfParticipantId) return;
      const matchedParticipant = participantRows.find((participant: any) => {
        const participantId = String(participant?.user_id || participant?.id || participant?.participant_id || "");
        const participantEmail = String(participant?.email || "").toLowerCase();
        const onlineEmail = String(onlineRow?.email || "").toLowerCase();
        return participantId === id || (participantEmail && onlineEmail && participantEmail === onlineEmail);
      });
      const existing = byId.get(id);
      byId.set(id, {
        id,
        name:
          onlineRow?.displayName
          || onlineRow?.name
          || matchedParticipant?.displayName
          || matchedParticipant?.name
          || matchedParticipant?.email
          || onlineRow?.email
          || existing?.name
          || "Thành viên",
        role: normalizeParticipantRole(onlineRow?.role || matchedParticipant?.role),
        micOn: onlineRow?.micOn ?? onlineRow?.mic_on ?? existing?.micOn ?? true,
        cameraOn: onlineRow?.cameraOn ?? onlineRow?.camera_on ?? existing?.cameraOn ?? true,
        handRaised: onlineRow?.handRaised ?? onlineRow?.hand_raised ?? existing?.handRaised ?? false,
        isSpeaking: onlineRow?.isSpeaking ?? onlineRow?.is_speaking ?? existing?.isSpeaking ?? false,
      });
    });
    return Array.from(byId.values());
  }, [selfParticipantId]);

  const participants = useMemo<Participant[]>(() => {
    const byId = new Map<string, Participant>();
    remoteParticipants.forEach((participant) => {
      if (!participant?.id || participant.id === selfParticipantId) return;
      byId.set(participant.id, participant);
    });
    return [selfParticipant, ...Array.from(byId.values())];
  }, [remoteParticipants, selfParticipant, selfParticipantId]);

  const spotlightParticipant = useMemo(() =>
    participants.find(p => p.id === spotlightId)
      || (spotlightId === selfParticipantId ? selfParticipant : undefined)
      || participants[0]
      || selfParticipant
  , [participants, selfParticipant, selfParticipantId, spotlightId]);

  const spotlightName = spotlightParticipant.name || "Người tham gia";
  const spotlightInitial = (spotlightName.trim()[0] || "?").toUpperCase();

  const galleryParticipants = useMemo(() => 
    participants.filter(p => p.id !== spotlightId)
  , [participants, spotlightId]);

  const sidebarParticipants = useMemo(
    () => participants.filter((participant) => participant.id !== selfParticipantId),
    [participants, selfParticipantId],
  );

  useEffect(() => {
    setSpotlightId((current) => (current === "me" ? selfParticipantId : current));
  }, [selfParticipantId]);

  useEffect(() => {
    if (!participants.some((participant) => participant.id === spotlightId)) {
      setSpotlightId(selfParticipantId);
    }
  }, [participants, selfParticipantId, spotlightId]);

  useEffect(() => {
    if (!code) return;
    const localMeeting = (meetings as any[]).find(m => m.code === code || m.id === code);
    let cancelled = false;
    setIsMeetingLoading(!localMeeting);
    setMeetingLoadError(null);
    setRemoteMeeting(null);
    const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
    api.get(looksLikeUuid ? `/api/meetings/${code}` : `/api/meetings/by-code/${code}`)
      .then((response) => {
        if (!cancelled) setRemoteMeeting(normalizeMeetingDetail(response.data));
      })
      .catch((err) => {
        if (!cancelled) setMeetingLoadError(err.response?.data?.detail || "Không thể tải cuộc họp");
      })
      .finally(() => {
        if (!cancelled) setIsMeetingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, meetings]);

  useEffect(() => {
    if (meetingId) {
      setSnapshotTranscripts([]);
      hydrateDraft(meetingId);
    }
  }, [hydrateDraft, meetingId]);

  useEffect(() => {
    if (!remoteMeeting) return;
    const remoteAiNotes = aiNotesFromMeeting(remoteMeeting);
    if (remoteAiNotes) {
      setAiNotes(remoteAiNotes);
      setAiNotesStatus(remoteMeeting.summaryStatus || "COMPLETED");
    } else if (remoteMeeting.summaryStatus) {
      setAiNotesStatus(remoteMeeting.summaryStatus);
    }
  }, [remoteMeeting]);

  useEffect(() => {
    if (!meetingId) return;
    connect(meetingId);
    api.get(`/api/meetings/${meetingId}/messages`)
      .then((response) => {
        const rows = Array.isArray(response.data) ? response.data : [];
        setChatMessages(rows.map(normalizeMeetingMessage));
      })
      .catch(() => {
        showToast.error("Không thể tải chat cuộc họp");
      });
    return () => disconnect();
  }, [connect, disconnect, meetingId]);

  // Fetch missed data after WebSocket reconnect
  useEffect(() => {
    onReconnect(() => {
      if (!meetingId) return;
      api.get(`/api/meetings/${meetingId}/messages`)
        .then((response) => {
          const rows = Array.isArray(response.data) ? response.data : [];
          setChatMessages((current) => {
            const existingIds = new Set(current.map((m) => m.id));
            const newMessages = rows.map(normalizeMeetingMessage).filter((m) => !existingIds.has(m.id));
            return newMessages.length > 0 ? [...current, ...newMessages] : current;
          });
        })
        .catch(() => {});
    });
  }, [onReconnect, meetingId]);

  useEffect(() => {
    if (!wsEvent) return;
    if (wsEvent.type === "room.snapshot") {
      if (wsEvent.snapshot_warning) {
        console.warn("Meeting room snapshot warning", wsEvent.snapshot_warning);
      }
      if (Array.isArray(wsEvent.messages)) {
        setChatMessages(wsEvent.messages.map(normalizeMeetingMessage));
      }
      const participantRows = Array.isArray(wsEvent.participants) ? wsEvent.participants : [];
      const onlineRows = Array.isArray(wsEvent.online_participants) ? wsEvent.online_participants : [];
      setRemoteParticipants(mapOnlineParticipants(onlineRows, participantRows));
      const transcriptPayload = wsEvent.transcript || {};
      const snapshotChunks = Array.isArray(transcriptPayload.chunks)
        ? transcriptPayload.chunks.map((chunk: any, index: number) => normalizeRoomTranscriptChunk(chunk, index, "snapshot"))
        : [];
      if (snapshotChunks.length) {
        setSnapshotTranscripts(snapshotChunks);
      } else if (transcriptPayload.transcript) {
        setSnapshotTranscripts([normalizeRoomTranscriptChunk({
          id: "snapshot-transcript",
          chunkIndex: -1,
          text: transcriptPayload.transcript,
          segments: transcriptPayload.segments || [],
          timestamp: wsEvent.timestamp,
        }, -1, "snapshot")]);
      } else {
        setSnapshotTranscripts([]);
      }
      if (wsEvent.ai_notes) {
        setAiNotes(wsEvent.ai_notes);
        setAiNotesStatus(wsEvent.ai_notes.processing_status || wsEvent.summary_status || null);
      } else {
        setAiNotesStatus(wsEvent.summary_status || null);
      }
      if (wsEvent.transcript_status || typeof wsEvent.has_transcript_draft === "boolean") {
        setRemoteMeeting((current) => current ? {
          ...current,
          transcriptStatus: wsEvent.transcript_status ?? current.transcriptStatus,
          hasTranscriptDraft: wsEvent.has_transcript_draft ?? current.hasTranscriptDraft,
          summaryStatus: wsEvent.summary_status ?? current.summaryStatus,
        } : current);
      }
      if (Array.isArray(wsEvent.action_items)) {
        setRemoteMeeting((current) => current ? { ...current, actionItems: dedupeActionItems(wsEvent.action_items) } : current);
      }
    } else if (wsEvent.type === "chat.message" && wsEvent.message) {
      const message = normalizeMeetingMessage(wsEvent.message);
      setChatMessages((current) =>
        current.some((item) => item.id === message.id) ? current : [...current, message],
      );
      if (sidePanel !== 'chat') {
        setUnreadChatCount((prev) => prev + 1);
      }
    } else if (wsEvent.type === "ai.notes.started") {
      setAiNotesStatus("PROCESSING");
      setRemoteMeeting((current) => current ? { ...current, summaryStatus: "PROCESSING" } : current);
      showToast.info("AI Notes đang được tạo cho 5 ngôn ngữ...");
    } else if ((wsEvent.type === "ai.notes.completed" || wsEvent.type === "ai.notes") && wsEvent.summary_status === "COMPLETED") {
      setAiNotes(wsEvent.summary || null);
      setAiNotesStatus("COMPLETED");
      setRemoteMeeting((current) => current ? { ...current, summaryStatus: "COMPLETED" } : current);
      showToast.success("AI Notes đã sẵn sàng");
    } else if (wsEvent.type === "ai.notes.failed") {
      setAiNotes(wsEvent.summary || null);
      setAiNotesStatus("FAILED");
      setRemoteMeeting((current) => current ? { ...current, summaryStatus: "FAILED" } : current);
      showToast.error("AI Notes tạo thất bại");
    } else if (wsEvent.type === "meeting.status" && wsEvent.status) {
      showToast.info(`Trạng thái cuộc họp: ${wsEvent.status}`);
    } else if (wsEvent.type === "transcript.interim" && wsEvent.text) {
      const key = wsEvent.user_id || wsEvent.speaker || "remote";
      if (wsEvent.user_id === user?.id) return;
      setRemoteInterims((current) => ({
        ...current,
        [key]: {
          text: wsEvent.text,
          speaker: wsEvent.speaker || "Speaker",
          timestamp: Date.now(),
        },
      }));
    } else if (wsEvent.type === "transcript.chunk" && wsEvent.user_id) {
      setRemoteInterims((current) => {
        const next = { ...current };
        delete next[wsEvent.user_id];
        return next;
      });
    } else if (wsEvent.type === "participant.list" && wsEvent.participants) {
      const participantRows = Array.isArray(wsEvent.all_participants) ? wsEvent.all_participants : [];
      setRemoteParticipants(mapOnlineParticipants(wsEvent.participants, participantRows));
    } else if (wsEvent.type === "participant.joined" && wsEvent.user) {
      if (wsEvent.user.id !== selfParticipantId) {
        setRemoteParticipants((prev) => mapOnlineParticipants([...prev, wsEvent.user], []));
        const name = wsEvent.user.displayName || wsEvent.user.email || "Một thành viên";
        showToast.info(`${name} đã vào phòng`);
      }
    } else if (wsEvent.type === "participant.left" && wsEvent.user) {
      setRemoteParticipants((prev) => prev.filter((participant) => participant.id !== wsEvent.user.id));
      const name = wsEvent.user.displayName || wsEvent.user.email || "Một thành viên";
      showToast.info(`${name} đã rời phòng`);
    } else if (wsEvent.type === "participant.state" && wsEvent.user_id) {
      setRemoteParticipants(prev => prev.map(p =>
        p.id === wsEvent.user_id
          ? { ...p, micOn: wsEvent.micOn ?? p.micOn, cameraOn: wsEvent.cameraOn ?? p.cameraOn }
          : p
      ));
    } else if (wsEvent.type === "action_item.updated" && wsEvent.action_item) {
      setRemoteMeeting((current) => {
        if (!current) return current;
        const nextItems = dedupeActionItems([...(current.actionItems || []).filter((item) => item.id !== wsEvent.action_item.id), wsEvent.action_item]);
        return { ...current, actionItems: nextItems };
      });
      setAiNotes((current: any) => {
        if (!current) return current;
        return {
          ...current,
          action_items: dedupeActionItems([...(Array.isArray(current.action_items) ? current.action_items.filter((item: any) => item.id !== wsEvent.action_item.id) : []), wsEvent.action_item]),
        };
      });
    } else if (wsEvent.type === "action_item.deleted" && wsEvent.action_item_id) {
      setRemoteMeeting((current) => current ? {
        ...current,
        actionItems: (current.actionItems || []).filter((item) => item.id !== wsEvent.action_item_id),
      } : current);
      setAiNotes((current: any) => {
        if (!current) return current;
        return {
          ...current,
          action_items: Array.isArray(current.action_items)
            ? current.action_items.filter((item: any) => item.id !== wsEvent.action_item_id)
            : current.action_items,
        };
      });
    }
  }, [mapOnlineParticipants, selfParticipantId, sidePanel, wsEvent]);

  // Transition meeting status: upcoming → live when entering room (organizer only)
  const statusUpdatedRef = useRef(false);
  useEffect(() => {
    if (
      meeting?.id &&
      isOrganizer &&
      ['upcoming', 'live'].includes(meeting.status) &&
      !statusUpdatedRef.current
    ) {
      statusUpdatedRef.current = true;
      api.post(`/api/meetings/${meeting.id}/start`).catch(() => {});
    }
  }, [meeting?.id, meeting?.status, isOrganizer]);

  // Auto-end meeting when organizer closes tab/browser
  useEffect(() => {
    if (!meetingId || !isOrganizer) return;
    const handleBeforeUnload = () => {
      const baseURL = import.meta.env.VITE_API_BASE_URL || window.location.origin;
      const sessionStr = localStorage.getItem("session");
      let token = "";
      try { token = sessionStr ? JSON.parse(sessionStr)?.token || "" : ""; } catch {}
      fetch(`${baseURL}/api/meetings/${meetingId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "completed" }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [meetingId, isOrganizer]);

  // Handle Camera Hardware Toggle
  const stopCameraHardware = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.stop();
        console.log("Webcam hardware released (track stopped)");
      });
    }
  }, [localStream]);

  const startCameraHardware = useCallback(async () => {
    try {
      // If we already have a stream, stop the old tracks first
      stopCameraHardware();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraOn ? { width: 1280, height: 720, facingMode: 'user' } : false,
        audio: true // Keep audio on
      });
      
      // If mic is off, ensure audio track is disabled initially
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = micOn;
      
      setLocalStream(stream);
      console.log("Webcam hardware initialized");
      return stream;
    } catch (err) {
      console.error("Camera hardware error:", err);
      setCameraOn(false);
      showToast.error("Không thể truy cập Camera. Kiểm tra quyền trình duyệt.");
      return null;
    }
  }, [cameraOn, micOn, stopCameraHardware]);

  // Initial Camera Start
  useEffect(() => {
    startCameraHardware();
    return () => {
      stopCameraHardware();
      if (localStream) localStream.getAudioTracks().forEach(t => t.stop());
    };
  }, []);

  // Auto-start audio recording when stream is ready
  useEffect(() => {
    if (isRecording && localStream && !isAudioRecording && meetingId) {
      const timer = setTimeout(() => {
        startRecording();
        showToast.info("Đã bắt đầu ghi âm và phiên âm AI");
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isRecording, localStream, meetingId]);

  // Strict Camera Toggle Effect
  useEffect(() => {
    if (cameraOn) {
      // Re-request hardware access when turning ON
      if (!localStream || !localStream.getVideoTracks()[0] || localStream.getVideoTracks()[0].readyState === 'ended') {
        startCameraHardware();
      } else {
        localStream.getVideoTracks()[0].enabled = true;
      }
    } else {
      // Completely STOP the track t
      // o turn off the hardware light
      if (localStream) {
        localStream.getVideoTracks().forEach(track => {
          track.enabled = false;
          track.stop(); // This is crucial for releasing the hardware
        });
        console.log("Camera track stopped and light should be OFF");
      }
    }
  }, [cameraOn]);

  // Mic Toggle Effect
  useEffect(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = micOn;
    }
  }, [micOn, localStream]);

  useEffect(() => {
    if (meetingId && isConnected) {
      sendJson({ type: "participant.state", micOn, cameraOn });
    }
  }, [cameraOn, isConnected, meetingId, micOn, sendJson]);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      screenStream?.getTracks().forEach(t => t.stop());
      setScreenStream(null);
      setScreenSharing(false);
      setMainView("camera");
      showToast.info("Đã dừng chia sẻ màn hình");
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" } as any,
          audio: false 
        });
        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null);
          setScreenSharing(false);
          setMainView("camera");
        };
        setScreenStream(stream);
        setScreenSharing(true);
        setMainView("screen");
        showToast.success("Đang chia sẻ màn hình");
      } catch (err) {
        console.error("Screen share error:", err);
        showToast.error("Không thể chia sẻ màn hình");
      }
    }
  };

  const [isFinalizing, setIsFinalizing] = useState(false);

  const applyFinalizeResult = useCallback((result: any) => {
    setRemoteMeeting((current) => current ? {
      ...current,
      transcriptStatus: result?.transcript_status ?? current.transcriptStatus,
      hasTranscriptDraft: result?.has_transcript_draft ?? current.hasTranscriptDraft,
      summaryStatus: result?.summary_status ?? current.summaryStatus,
    } : current);
    if (result?.summary) {
      setAiNotes(result.summary);
    }
    if (result?.summary_status) {
      setAiNotesStatus(result.summary_status);
    }
    if (result?.transcript_status === "EMPTY") {
      showToast.info("Chưa phát hiện giọng nói rõ để lưu transcript.");
      return;
    }
    if (result?.summary_status === "COMPLETED") {
      showToast.success("Đã lưu transcript và tạo AI Notes cho 5 ngôn ngữ thành công.");
      return;
    }
    if (result?.summary_status === "FAILED") {
      showToast.error("Đã lưu transcript, chưa tạo được bản tổng hợp.");
      return;
    }
    showToast.info("Đã lưu transcript.");
  }, []);

  const leaveMeeting = async () => {
    // Participant: chỉ rời phòng, không kết thúc cuộc họp
    if (!isOrganizer) {
      stopCameraHardware();
      localStream?.getAudioTracks().forEach(t => t.stop());
      screenStream?.getTracks().forEach(t => t.stop());
      disconnect();
      showToast.info("Bản nháp transcript vẫn được giữ lại trong cuộc họp.");
      navigate("/meetings");
      return;
    }

    // Organizer: kết thúc cuộc họp + finalize
    if (meetingId) {
      setIsFinalizing(true);
      showToast.info("Đang lưu transcript và tạo AI Notes cho 5 ngôn ngữ...");
      try {
        await api.post(`/api/meetings/${meetingId}/start`).catch(() => {});
        await api.post(`/api/meetings/${meetingId}/end`, { status: "processing" });
        if (isRecording) {
          try {
            const result = await finalize(meetingId);
            applyFinalizeResult(result);
          } catch (err: any) {
            if (err?.response?.status === 400) {
              showToast.info("Cuộc họp đã kết thúc. Nếu có transcript draft, bạn vẫn có thể xem lại sau.");
            } else {
              console.error("Finalize error:", err);
              showToast.error("Bản nháp transcript vẫn được giữ lại, nhưng chưa finalize được.");
            }
          }
        } else {
          showToast.success("Cuộc họp đã kết thúc.");
        }
        // Always set meeting to completed, even if finalize failed
        await api.post(`/api/meetings/${meetingId}/end`, { status: "completed" }).catch(() => {});
        navigate(`/meetings/${meetingId}`);
      } catch {
        // Last resort: try to end the meeting anyway
        await api.post(`/api/meetings/${meetingId}/end`, { status: "completed" }).catch(() => {});
        showToast.error("Đã kết thúc cuộc họp. Nếu transcript chưa finalize, bản nháp vẫn còn.");
        navigate("/meetings");
      } finally {
        setIsFinalizing(false);
        stopCameraHardware();
        localStream?.getAudioTracks().forEach(t => t.stop());
        screenStream?.getTracks().forEach(t => t.stop());
      }
    } else {
      stopCameraHardware();
      localStream?.getAudioTracks().forEach(t => t.stop());
      screenStream?.getTracks().forEach(t => t.stop());
      navigate("/meetings");
    }
  };

  const displayTranscripts = useMemo(() => {
    const merged = new Map<string, any>();
    const add = (item: any, fallbackIndex: number, source: string) => {
      const speakerKey = item.userId || item.speaker || source;
      const chunkKey = item.chunkIndex ?? fallbackIndex;
      const key = `${speakerKey}:${chunkKey}`;
      const normalized = normalizeRoomTranscriptChunk(item, fallbackIndex, source);
      merged.set(key, {
        id: normalized.id || key,
        userId: normalized.userId,
        chunkIndex: normalized.chunkIndex,
        text: normalized.text,
        segments: normalized.segments,
        timestamp: normalized.timestamp,
      });
    };
    snapshotTranscripts.forEach((item, index) => add(item, index, "snapshot"));
    wsTranscripts.forEach((item, index) => add(item, index, "ws"));
    liveTranscripts.forEach((item, index) => add(item, index, "local"));
    return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [liveTranscripts, snapshotTranscripts, wsTranscripts]);

  const displayInterims = useMemo(() => {
    const rows = Object.entries(remoteInterims)
      .filter(([, value]) => value?.text && Date.now() - Number(value.timestamp || 0) < 15000)
      .map(([id, value]) => ({ id, ...value }));
    if (interimTranscript.trim()) {
      rows.push({
        id: selfParticipantId,
        speaker: "Bạn",
        text: interimTranscript.trim(),
        timestamp: Date.now(),
      });
    }
    return rows;
  }, [interimTranscript, remoteInterims, selfParticipantId]);

  const aiNotesSummary = aiNotes?.meeting_summary || aiNotes?.meetingSummary || remoteMeeting?.meetingSummaryText || "";
  const aiNotesKeyPoints = Array.isArray(aiNotes?.key_points)
    ? aiNotes.key_points
    : Array.isArray(aiNotes?.keyPoints)
      ? aiNotes.keyPoints
      : remoteMeeting?.keyPointsText || [];
  const transcriptPersistenceLabel =
    displayTranscripts.length > 0 || fullTranscript.trim()
      ? "Đang lưu bản nháp transcript"
      : meeting?.transcriptStatus === "COMPLETED"
        ? "Đã lưu transcript"
        : meeting?.hasTranscriptDraft
          ? "Đang lưu bản nháp transcript"
          : "Chưa có transcript";
  const summaryPersistenceLabel =
    aiNotesStatus === "COMPLETED"
      ? "AI Notes đã sẵn sàng"
      : aiNotesStatus === "FAILED"
        ? "Đã lưu bản nháp, chưa tạo được bản tổng hợp"
        : aiNotesStatus === "PROCESSING"
          ? "Đang tạo bản tổng hợp 5 ngôn ngữ"
          : "Chưa có bản tổng hợp";
  if (isMeetingLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617] p-6">
        <div className="w-full max-w-2xl">
          <PageState
            title="Đang kết nối vào phòng họp"
            description="Hệ thống đang tải cuộc họp, trạng thái realtime và transcript draft gần nhất trước khi đưa bạn vào phòng."
            tone="loading"
          />
        </div>
      </div>
    );
  }

  if (meetingLoadError || !meeting) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617] p-6">
        <div className="w-full max-w-2xl">
          <PageState
            title="Không thể vào phòng họp"
            description={meetingLoadError || "Cuộc họp không tồn tại hoặc bạn không có quyền truy cập."}
            tone="error"
            action={(
              <button onClick={() => navigate("/meetings")} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
                Quay lại danh sách
              </button>
            )}
          />
        </div>
      </div>
    );
  }

  // Block entry if meeting is upcoming and more than 15 minutes away (unless organizer)
  if (meeting?.status === 'upcoming' && !isOrganizer) {
    const meetingStart = meeting.startTime ? new Date(meeting.startTime).getTime() : 0;
    const minutesUntilStart = Math.round((meetingStart - Date.now()) / 60000);
    if (minutesUntilStart > 15) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617] p-6">
          <div className="w-full max-w-2xl">
            <PageState
              title="Cuộc họp chưa tới giờ"
              description={`Cuộc họp "${meeting.title}" bắt đầu trong ${minutesUntilStart} phút nữa. Bạn có thể vào phòng khi còn 15 phút trước giờ họp.`}
              tone="processing"
              action={(
                <button onClick={() => navigate("/meetings")} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
                  Quay lại danh sách
                </button>
              )}
            />
          </div>
        </div>
      );
    }
  }

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || !meetingId) return;
    setChatInput("");
    const sentViaSocket = sendJson({ type: "chat.send", text });
    if (!sentViaSocket) {
      try {
        const response = await api.post(`/api/meetings/${meetingId}/messages`, { text });
        const message = normalizeMeetingMessage(response.data);
        setChatMessages((current) =>
          current.some((item) => item.id === message.id) ? current : [...current, message],
        );
      } catch (err: any) {
        showToast.error(err?.response?.data?.detail || "Không gửi được tin nhắn");
        setChatInput(text);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#020617] text-slate-100 overflow-hidden font-sans">
      {/* Premium Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-[#020617]/80 backdrop-blur-md border-b border-slate-800/50 z-20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">{meeting?.title || 'Cuộc họp'}</h1>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold ${localStream && cameraOn ? 'text-green-400' : 'text-slate-500'}`}>
                {localStream && cameraOn ? '● Camera sẵn sàng' : '○ Camera đang tắt'}
              </span>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mã: {code}</span>
              <div className="h-1 w-1 rounded-full bg-slate-700" />
              <span className={clsx("text-[10px] font-bold uppercase tracking-widest", isConnected ? "text-emerald-400" : "text-amber-400")}>
                {isConnected ? "Realtime" : wsStatus === "connecting" ? "Đang nối realtime" : "Realtime fallback"}
              </span>
              <div className="h-1 w-1 rounded-full bg-slate-700" />
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-black uppercase tracking-tighter">
                <Users size={10} /> {participants.length} Người tham gia
              </div>
              {isMeetingGuest && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] font-black uppercase tracking-tighter">
                  <ShieldCheck size={10} /> Guest participant
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-900/30 border border-green-500/30">
             <span className={`w-2 h-2 rounded-full ${localStream && cameraOn ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
             <span className="text-xs font-bold text-green-400">{localStream && cameraOn ? 'LIVE' : 'OFFLINE'}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-900 border border-slate-800">
             <RecordingTimer isRecording={isAudioRecording} />
             <div className="h-4 w-px bg-slate-800" />
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AI Transcript Live</p>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(window.location.href); showToast.success("Link đã sao chép!"); }} className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
            <UserPlus size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar - Participants & Grid Actions */}
        <aside className="w-80 border-r border-white/5 bg-[#020617]/80 backdrop-blur-2xl flex flex-col hidden lg:flex z-20">
          <div className="p-6 border-b border-white/5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                  <Users size={16} className="text-indigo-400" />
                </div>
                <span className="text-xs font-black text-slate-200 uppercase tracking-widest">Thành viên</span>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-2 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition-all active:scale-90">
                  <Settings size={16} />
                </button>
              </div>
            </div>
            
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                 <LayoutGrid size={14} />
              </div>
              <input 
                type="text" 
                placeholder="Tìm kiếm..." 
                className="w-full bg-slate-900/40 border border-white/5 rounded-2xl pl-10 pr-4 py-2.5 text-xs outline-none focus:border-indigo-500/50 focus:bg-slate-900/80 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="space-y-6">
              {/* Category: Host/Organizer */}
              <div className="space-y-3">
                <div className="px-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Điều phối viên</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 text-[8px] font-black uppercase">1</span>
                </div>
                
                {/* Me Participant */}
                <motion.div 
                  layout
                  onClick={() => setSpotlightId(selfParticipantId)}
                  className={clsx(
                    "group relative p-3 rounded-2xl border transition-all cursor-pointer overflow-hidden",
                    spotlightId === selfParticipantId 
                      ? "bg-gradient-to-br from-indigo-500/10 to-transparent border-indigo-500/30 ring-1 ring-indigo-500/20 shadow-lg shadow-indigo-500/5" 
                      : "bg-white/[0.02] border-white/5 hover:border-white/10 hover:bg-white/[0.04]"
                  )}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-slate-800 overflow-hidden border border-white/10 relative shadow-inner">
                       {cameraOn && localStream ? (
                          <VideoView stream={localStream} mirror={true} className="scale-110" muted={true} />
                       ) : (
                          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-indigo-500/20 to-slate-800 text-indigo-400 font-black text-lg">
                            {(user?.displayName || "Me")[0]}
                          </div>
                       )}
                       {spotlightId === selfParticipantId && (
                         <div className="absolute inset-0 border-2 border-indigo-500/50 rounded-2xl z-20 pointer-events-none" />
                       )}
                       <div className="absolute bottom-1 right-1 z-30">
                          <div className={clsx(
                            "w-2.5 h-2.5 rounded-full border-2 border-slate-900 shadow-sm",
                            localStream && cameraOn ? "bg-emerald-500" : "bg-rose-500"
                          )} />
                       </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-black text-slate-200 truncate tracking-tight">Bạn</p>
                        <ShieldCheck size={12} className="text-indigo-400 flex-shrink-0" />
                      </div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Ban tổ chức</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col items-end gap-1">
                        {!micOn ? (
                          <MicOff size={14} className="text-rose-500/80" />
                        ) : (
                          <div className="h-4 flex items-end gap-0.5 px-1">
                             {[1, 2, 3].map(i => (
                               <motion.div 
                                 key={i}
                                 animate={{ height: [4, 10, 4] }}
                                 transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                                 className="w-0.5 bg-emerald-500 rounded-full"
                               />
                             ))}
                          </div>
                        )}
                        {screenSharing && (
                          <div className="p-1 rounded-md bg-indigo-500/20">
                            <MonitorUp size={10} className="text-indigo-400" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Category: Participants */}
              <div className="space-y-3">
                <div className="px-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Thành viên khác</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-slate-400 text-[8px] font-black uppercase">{sidebarParticipants.length}</span>
                </div>

                <div className="space-y-2">
                  {sidebarParticipants.map(p => (
                    <motion.div 
                      layout
                      key={p.id} 
                      onClick={() => setSpotlightId(p.id)}
                      className={clsx(
                        "group relative p-3 rounded-2xl border transition-all cursor-pointer overflow-hidden",
                        spotlightId === p.id 
                          ? "bg-indigo-500/10 border-indigo-500/30 shadow-lg shadow-indigo-500/5" 
                          : "bg-white/[0.01] border-white/5 hover:border-white/10 hover:bg-white/[0.03]"
                      )}
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 overflow-hidden border border-white/5 relative group-hover:border-white/20 transition-colors">
                          {p.cameraOn ? (
                             <div className="h-full w-full bg-indigo-500/5 flex items-center justify-center">
                                <Video size={16} className="text-slate-500" />
                             </div>
                          ) : (
                            <div className="h-full w-full flex items-center justify-center bg-slate-800 text-slate-400 font-black text-sm uppercase">
                              {p.name[0]}
                            </div>
                          )}
                          {spotlightId === p.id && (
                            <div className="absolute inset-0 border-2 border-indigo-500/50 rounded-xl z-20 pointer-events-none" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            "text-xs font-bold truncate transition-colors",
                            spotlightId === p.id ? "text-indigo-300" : "text-slate-300 group-hover:text-white"
                          )}>{p.name}</p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter opacity-80">{p.role}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {!p.micOn ? (
                             <MicOff size={12} className="text-slate-600" />
                          ) : p.isSpeaking ? (
                            <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
                          ) : null}
                          <button className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all">
                             <MoreVertical size={14} />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Footer: Advanced Controls */}
          <div className="p-6 border-t border-white/5 bg-slate-950/40 backdrop-blur-md">
            <div className="grid grid-cols-2 gap-3">
              <button className="flex flex-col items-center justify-center gap-2 p-4 rounded-[1.25rem] bg-indigo-500/5 border border-indigo-500/10 hover:bg-indigo-500/10 hover:border-indigo-500/20 transition-all group active:scale-95 shadow-sm shadow-indigo-500/5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 group-hover:scale-110 transition-transform">
                  <ShieldCheck size={16} className="text-indigo-400" />
                </div>
                <span className="text-[10px] font-black text-slate-400 group-hover:text-indigo-300 uppercase tracking-wider">Bảo mật</span>
              </button>
              <button className="flex flex-col items-center justify-center gap-2 p-4 rounded-[1.25rem] bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all group active:scale-95 shadow-sm">
                <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
                  <Volume2 size={16} className="text-slate-400 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-black text-slate-500 group-hover:text-slate-300 uppercase tracking-wider">Cấu hình</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 p-6 relative flex flex-col gap-4">
          <div className="flex-1 relative rounded-[2.5rem] bg-slate-900 border border-slate-800 overflow-hidden shadow-2xl group">
              {spotlightId === selfParticipantId ? (
                localStream && cameraOn ? (
                  <div className="h-full w-full bg-black relative">
                    <VideoView
                      stream={screenSharing && screenStream && mainView === "screen" ? screenStream : localStream}
                      mirror={!(screenSharing && screenStream && mainView === "screen")}
                      objectFit={screenSharing && screenStream && mainView === "screen" ? 'contain' : 'cover'}
                      muted={true}
                    />
                    
                    {screenSharing && screenStream && localStream && (
                      <div 
                        onClick={() => setMainView(mainView === "camera" ? "screen" : "camera")}
                        className="absolute bottom-4 right-4 w-48 h-36 rounded-xl overflow-hidden border-2 border-indigo-500/40 shadow-2xl bg-black cursor-pointer hover:border-indigo-500 transition-all z-10 group/pip"
                      >
                        <VideoView
                          stream={mainView === "screen" ? localStream : screenStream}
                          mirror={mainView === "screen"}
                          objectFit={mainView === "screen" ? 'cover' : 'contain'}
                          muted={true}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/pip:opacity-100 flex items-center justify-center transition-opacity">
                           <Maximize2 size={16} className="text-white" />
                        </div>
                        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[8px] text-white">
                          {mainView === "screen" ? "" : "Màn hình"}
                        </div>
                      </div>
                    )}
                    
                    <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/50 rounded-lg text-white text-xs flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${cameraOn ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                      {cameraOn ? 'Camera bật' : 'Camera tắt'}
                    </div>
                  </div>
                ) : (
                 <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
                    <div className="w-32 h-32 rounded-full bg-indigo-500/10 border-4 border-indigo-500/20 flex items-center justify-center mb-6 shadow-2xl">
                       <span className="text-5xl font-black text-indigo-400">{(user?.displayName || user?.email || ' ')[0].toUpperCase()}</span>
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-white">{user?.displayName || user?.email || ''}</h2>
                    <p className="text-sm font-bold text-slate-500 mt-2">Camera đang tắt</p>
                 </div>
                )
              ) : (
               <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
                  <div className="w-32 h-32 rounded-full bg-indigo-500/10 border-4 border-indigo-500/20 flex items-center justify-center mb-6 shadow-2xl">
                     <span className="text-5xl font-black text-indigo-400">{spotlightInitial}</span>
                  </div>
                  <h2 className="text-xl font-black tracking-tight text-white">{spotlightName}</h2>
                  <p className="text-sm font-bold text-slate-500 mt-2">Đang là diễn giả chính</p>
                  
                  <div className="mt-8 flex items-end gap-1.5 h-12">
                     {WAVEFORM_HEIGHTS.map((h, i) => (
                       <motion.div 
                         key={i}
                         animate={{ height: [10, h, 10] }}
                         transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
                         className="w-1.5 bg-indigo-500 rounded-full"
                       />
                     ))}
                  </div>
               </div>
             )}

             <div className="absolute top-6 left-6 flex items-center gap-3">
                <div className="px-4 py-2 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center gap-2">
                   <span className="text-xs font-black text-white">{spotlightName}</span>
                   {spotlightParticipant.role === 'organizer' && <span className="px-1.5 py-0.5 rounded-md bg-indigo-500 text-[8px] font-black uppercase">Host</span>}
                </div>
             </div>

             <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-3 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 hover:bg-white/10 transition-colors">
                   <Maximize2 size={18} />
                </button>
                <button className="p-3 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 hover:bg-white/10 transition-colors">
                   <MoreVertical size={18} />
                </button>
             </div>

             <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 rounded-full bg-black/40 backdrop-blur-2xl border border-white/10 shadow-2xl">
                <button onClick={() => setMicOn(!micOn)} className={clsx("p-4 rounded-full transition-all duration-300", micOn ? "bg-slate-800 text-white hover:bg-slate-700" : "bg-red-500 text-white shadow-lg shadow-red-500/40")}>
                  {micOn ? <Mic size={22} /> : <MicOff size={22} />}
                </button>
                <button onClick={() => setCameraOn(!cameraOn)} className={clsx("p-4 rounded-full transition-all duration-300", cameraOn ? "bg-green-600 text-white hover:bg-green-500" : "bg-slate-800 text-white hover:bg-slate-700")}>
                  {cameraOn ? <Video size={22} /> : <VideoOff size={22} />}
                </button>
                <div className="w-px h-8 bg-white/10 mx-1" />
                <button onClick={toggleScreenShare} className={clsx("p-4 rounded-full transition-all", screenSharing ? "bg-indigo-500 text-white" : "bg-slate-800 text-white hover:bg-slate-700")}>
                   <MonitorUp size={22} />
                 </button>
                <button onClick={() => { const next = sidePanel === 'chat' ? null : 'chat'; setSidePanel(next); if (next === 'chat') setUnreadChatCount(0); }} className={clsx("p-4 rounded-full transition-all relative", sidePanel === 'chat' ? "bg-indigo-500 text-white" : "bg-slate-800 text-white hover:bg-slate-700")}>
                   <MessageSquare size={22} />
                   {unreadChatCount > 0 && sidePanel !== 'chat' && (
                     <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                       {unreadChatCount > 9 ? '9+' : unreadChatCount}
                     </span>
                   )}
                </button>
                <button onClick={() => setSidePanel(sidePanel === 'ai-notes' ? null : 'ai-notes')} className={clsx("p-4 rounded-full transition-all", sidePanel === 'ai-notes' ? "bg-indigo-500 text-white" : "bg-slate-800 text-white hover:bg-slate-700")}>
                   <Sparkles size={22} />
                </button>
                <div className="w-px h-8 bg-white/10 mx-1" />
                <button onClick={leaveMeeting} disabled={isFinalizing} title={isOrganizer ? "Kết thúc cuộc họp" : "Rời phòng"} className={clsx("p-4 rounded-full shadow-lg transition-all active:scale-95", isOrganizer ? (isFinalizing ? "bg-amber-600 cursor-wait" : "bg-rose-600 hover:bg-rose-700 shadow-rose-600/40") : "bg-slate-700 hover:bg-slate-600")}>
                   {isOrganizer ? (
                     <PhoneOff size={22} className={clsx("transition-transform duration-500", isFinalizing ? "animate-spin" : "group-hover/leave:-rotate-[135deg]")} />
                   ) : (
                     <LogOut size={22} />
                   )}
                </button>
             </div>
          </div>
        </main>

        <AnimatePresence>
          {sidePanel && (
            <motion.aside
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              className="w-96 border-l border-slate-800 bg-[#020617] flex flex-col z-30 shadow-2xl"
            >
              <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800">
                <div className="flex items-center gap-2">
                   {sidePanel === 'ai-notes' ? (
                      <><Sparkles className="text-indigo-400" size={18} /> <span className="text-sm font-black uppercase tracking-widest">AI Intelligent Notes</span></>
                   ) : (
                      <><MessageSquare className="text-indigo-400" size={18} /> <span className="text-sm font-black uppercase tracking-widest">Team Conversation</span></>
                   )}
                </div>
                <button onClick={() => setSidePanel(null)} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
                   <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-8">
                 {sidePanel === 'ai-notes' ? (
                   <>
                      {/* Recording Status */}
                      <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
                         <div className={`w-3 h-3 rounded-full ${isAudioRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
                         <span className="text-xs font-bold text-slate-300">
                            {isAudioRecording ? 'Đang ghi âm & phiên âm AI...' : isFinalizing ? 'Đang lưu và tóm tắt...' : 'Chưa ghi âm'}
                         </span>
                         {displayTranscripts.length > 0 && (
                            <span className="ml-auto text-[10px] font-bold text-indigo-400">{displayTranscripts.length} đoạn</span>
                         )}
                      </div>

                      {recorderError && (
                         <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            {recorderError}
                         </div>
                      )}

                      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                        <div className="mb-3 flex items-center gap-2 text-slate-300">
                          <Sparkles size={15} className="text-indigo-400" />
                          <span className="text-xs font-black uppercase tracking-widest">AI readiness</span>
                        </div>
                        <div className="space-y-2 text-xs text-slate-400">
                          <p><span className="font-bold text-slate-200">Cuộc họp:</span> {meeting.title}</p>
                          <p><span className="font-bold text-slate-200">Nhóm:</span> {meeting.groupName || meeting.group?.name || "Chưa gắn nhóm"}</p>
                          <p><span className="font-bold text-slate-200">Người tham gia:</span> {participants.length}</p>
                          <p><span className="font-bold text-slate-200">Transcript:</span> {transcriptPersistenceLabel}</p>
                          <p><span className="font-bold text-slate-200">Tóm tắt:</span> {summaryPersistenceLabel}</p>
                        </div>
                      </div>

                      {(aiNotesStatus || aiNotesSummary) && (
                        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-emerald-400">
                              <Sparkles size={15} />
                              <span className="text-xs font-black uppercase tracking-widest">AI Notes chung</span>
                            </div>
                            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase text-slate-400">
                              {aiNotesStatus || "READY"}
                            </span>
                          </div>
                          {aiNotesStatus === "PROCESSING" && (
                            <p className="text-sm text-slate-400">Đang tạo AI Notes, mọi người trong phòng sẽ thấy khi hoàn tất.</p>
                          )}
                          {aiNotesSummary && (
                            <p className="text-sm leading-relaxed text-slate-300">{aiNotesSummary}</p>
                          )}
                          {aiNotesKeyPoints.length > 0 && (
                            <ul className="mt-3 space-y-1 text-sm text-slate-400">
                              {aiNotesKeyPoints.slice(0, 5).map((point: any, index: number) => (
                                <li key={`${index}-${String(point)}`} className="flex gap-2">
                                  <span className="text-emerald-400">•</span>
                                  <span>{String(point)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Live Transcript Sections */}
                      <div className="space-y-4">
                         <div className="flex items-center gap-2 text-indigo-400">
                            <FileText size={16} />
                            <span className="text-xs font-bold uppercase tracking-widest">Phiên âm trực tiếp</span>
                         </div>
                         <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {displayTranscripts.length === 0 ? (
                               <div className="p-5 rounded-[1.5rem] bg-indigo-500/5 border border-indigo-500/10 text-slate-500 text-sm text-center">
                                  {isAudioRecording ? "Đang lắng nghe... Hãy nói chuyện để xem phiên âm real-time." : "Chờ bắt đầu ghi âm..."}
                               </div>
                            ) : (
                               displayTranscripts.map((t) => (
                                  <div key={t.id} className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10">
                                     <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px] font-bold text-indigo-400">
                                           {new Date(t.timestamp).toLocaleTimeString("vi-VN")}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-600">
                                           {t.segments.length > 0 ? `${t.segments.length} câu` : ""}
                                        </span>
                                     </div>
                                     {t.segments.length > 0 ? (
                                       <div className="space-y-2">
                                         {t.segments.map((segment: any, index: number) => (
                                           <div key={`${t.id}-${index}`}>
                                             <div className="mb-1 flex items-center gap-2">
                                               <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                                                 {segment.speaker_display_name || segment.speaker || segment.speaker_label || "Speaker_01"}
                                               </span>
                                               {segment.language && (
                                                 <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                                                   {segment.language}
                                                 </span>
                                               )}
                                             </div>
                                             <p className="text-sm text-slate-300 leading-relaxed">{segment.text}</p>
                                           </div>
                                         ))}
                                       </div>
                                     ) : (
                                       <p className="text-sm text-slate-300 leading-relaxed">{t.text}</p>
                                     )}
                                  </div>
                               ))
                            )}
                         </div>
                      </div>

                      {/* Full Transcript Preview */}
                      {fullTranscript && (
                         <div className="space-y-4">
                           <div className="flex items-center gap-2 text-emerald-400">
                               <Target size={16} />
                               <span className="text-xs font-bold uppercase tracking-widest">Toàn bộ transcript</span>
                            </div>
                            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-300">
                               {transcriptPersistenceLabel}
                            </p>
                            <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 text-sm text-slate-400 max-h-40 overflow-y-auto custom-scrollbar leading-relaxed">
                               {fullTranscript}
                            </div>
                         </div>
                      )}

                      {/* Generate AI Notes Button */}
                      {fullTranscript && meetingId && (
                         <button
                           onClick={async () => {
                             setIsFinalizing(true);
                             try {
                               const result = await finalize(meetingId);
                               applyFinalizeResult(result);
                             } catch {
                               showToast.error("Bản nháp transcript vẫn được giữ lại, nhưng chưa tạo được AI Notes.");
                             } finally {
                               setIsFinalizing(false);
                             }
                           }}
                           disabled={isFinalizing}
                           className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-3.5 text-sm font-black text-white transition hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                         >
                           <Sparkles size={18} className={isFinalizing ? "animate-spin" : ""} />
                           {isFinalizing ? "Đang lưu transcript..." : "Lưu transcript & tạo AI Notes"}
                         </button>
                      )}
                   </>
                 ) : (
                   <div className="flex flex-col h-full">
                      <div className="flex-1 space-y-4">
                         {chatMessages.length === 0 ? (
                            <div className="p-4 text-center text-slate-600 text-sm">
                               Chưa có tin nhắn nào. Chat trong phòng sẽ được lưu lại sau khi reload.
                            </div>
                         ) : (
                            chatMessages.map((message) => (
                               <div key={message.id} className={clsx("flex flex-col gap-1", message.userId === user?.id ? "items-end" : "items-start")}>
                                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-tighter text-indigo-400">
                                    <span>{message.user?.displayName || message.user?.email || "Thành viên"}</span>
                                    <span className="text-slate-600">{new Date(message.createdAt).toLocaleTimeString("vi-VN")}</span>
                                  </div>
                                  <div className={clsx(
                                    "max-w-[85%] px-4 py-2.5 rounded-2xl border text-sm",
                                    message.userId === user?.id
                                      ? "bg-indigo-600 border-indigo-500 text-white"
                                      : "bg-slate-900 border-slate-800 text-slate-300"
                                  )}>
                                     {message.text}
                                  </div>
                               </div>
                            ))
                         )}
                      </div>
                      <div className="pt-6">
                         <form onSubmit={sendChat} className="relative">
                            <input
                              type="text"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              placeholder="Gửi tin nhắn cho mọi người..."
                              className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-5 py-3.5 text-sm outline-none focus:border-indigo-500 transition-all"
                            />
                            <button className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-xl">
                               <Send size={16} />
                            </button>
                         </form>
                      </div>
                   </div>
                 )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {!sidePanel && spotlightId !== selfParticipantId && (
         <div className="absolute bottom-24 right-8 w-48 aspect-video rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden hidden lg:block z-10">
            <VideoView stream={localStream} mirror={true} muted={true} />
         </div>
      )}
    </div>
  );
};

const MeetingRoom: React.FC = () => (
  <MeetingRoomErrorBoundary>
    <MeetingRoomInner />
  </MeetingRoomErrorBoundary>
);

export default MeetingRoom;
