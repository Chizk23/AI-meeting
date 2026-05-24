import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  FolderOpen,
  Mic,
  MicOff,
  Settings2,
  Sparkles,
  UserPlus,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { Button, showToast } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useAppStore, useOrgStore } from "../stores";
import { useGroupMembers } from "../hooks/useGroupMembers";
import api from "../services/api";

type Tab = "room" | "members";

const generateMeetingCode = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join(""),
  ).join("-");
};

const CreateMeeting: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { currentOrgId, groups, loadGroups } = useOrgStore();
  const { loadMeetings } = useAppStore();
  const [activeTab, setActiveTab] = useState<Tab>("room");
  const [title, setTitle] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [language, setLanguage] = useState("vi");
  const [enableCamera, setEnableCamera] = useState(true);
  const [enableMic, setEnableMic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [meetingCode] = useState(generateMeetingCode);

  const streamRef = useRef<MediaStream | null>(null);
  const [streamReady, setStreamReady] = useState(false);

  // Manage webcam stream
  useEffect(() => {
    if (!enableCamera) {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setStreamReady(false);
      return;
    }

    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setStreamReady(true);
      } catch {
        if (!cancelled) setEnableCamera(false);
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setStreamReady(false);
    };
  }, [enableCamera]);

  // Callback ref: attach stream when <video> mounts
  const videoCallbackRef = (node: HTMLVideoElement | null) => {
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
    }
  };

  const requestedGroupId = searchParams.get("groupId") || "";
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId),
    [groups, selectedGroupId],
  );

  const {
    members,
    loading: loadingMembers,
    selectedIds: selectedParticipants,
    setSelectedIds: setSelectedParticipants,
    toggleSelectAll,
    toggleMember,
  } = useGroupMembers(selectedGroupId, user?.id);

  useEffect(() => {
    if (!currentOrgId) return;
    loadGroups(currentOrgId);
  }, [currentOrgId, loadGroups]);

  useEffect(() => {
    if (requestedGroupId && groups.some((group) => group.id === requestedGroupId)) {
      setSelectedGroupId(requestedGroupId);
      return;
    }
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id);
      return;
    }
    if (selectedGroupId && groups.length > 0 && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, requestedGroupId, selectedGroupId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentOrgId) { showToast.error("Chưa chọn tổ chức"); return; }
    if (!title.trim()) { showToast.error("Vui lòng nhập tiêu đề cuộc họp"); return; }
    if (!selectedGroupId) { showToast.error("Vui lòng chọn nhóm/phòng ban"); return; }

    setIsSubmitting(true);
    try {
      const start = new Date();
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const response = await api.post("/api/meetings", {
        title: title.trim(),
        organization_id: currentOrgId,
        group_id: selectedGroupId,
        code: meetingCode,
        status: "live",
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        actual_start: start.toISOString(),
        description: `Cuộc họp live trong nhóm ${selectedGroup?.name || selectedGroupId}`,
        settings: {
          enableRecord: true,
          enableSummary: true,
          language,
          enableCamera,
          enableMic,
        },
        participant_ids: selectedParticipants,
      });

      await loadMeetings(currentOrgId);
      const roomCode = response.data?.code || meetingCode || response.data?.id;
      showToast.success("Đã tạo cuộc họp live");
      navigate(`/room/${roomCode}`, {
        state: {
          title: title.trim(),
          groupId: selectedGroupId,
          organizer: user?.displayName || user?.email || "Bạn",
          enableCamera,
          enableMic,
          enableRecord: true,
          enableSummary: true,
          participants: selectedParticipants,
        },
      });
    } catch (err) {
      const detail = axios.isAxiosError<{ detail?: string }>(err) ? err.response?.data?.detail : undefined;
      showToast.error(detail || "Không thể tạo cuộc họp live");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentOrgId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-50 dark:bg-amber-900/20">
            <AlertCircle className="h-10 w-10 text-amber-500" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-slate-100">Chưa chọn tổ chức</h1>
          <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-slate-400">
            Bạn cần chọn hoặc tham gia một tổ chức trước khi tạo cuộc họp.
          </p>
          <Button className="mt-8" onClick={() => navigate("/setup-organization")}>Thiết lập tổ chức</Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-0">
      <form onSubmit={handleSubmit}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-4"
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black text-gray-900 dark:text-slate-100">
              {title || "Tạo và vào phòng ngay"}
            </h1>
            <p className="text-xs text-gray-400 dark:text-slate-500">
              {selectedGroup?.name || currentOrgId ? "Cuộc họp live sẽ bắt đầu ngay sau khi tạo" : ""}
            </p>
          </div>

          {/* Live badge */}
          <div className="ml-auto inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-red-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Live
          </div>
        </motion.div>

        {/* Tab switcher */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-6 flex rounded-2xl bg-gray-100 p-1.5 dark:bg-slate-800"
        >
          <button
            type="button"
            onClick={() => setActiveTab("room")}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
              activeTab === "room"
                ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Video size={16} />
            Phòng họp
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
              activeTab === "members"
                ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Users size={16} />
            Thành viên
            {selectedParticipants.length > 0 && (
              <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white">
                {selectedParticipants.length}
              </span>
            )}
          </button>
        </motion.div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {activeTab === "room" && (
            <motion.div
              key="room"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="space-y-5"
            >
              {/* Camera preview */}
              <div className="relative overflow-hidden rounded-3xl bg-gray-900">
                <div className="relative flex aspect-video items-center justify-center">
                  {enableCamera && streamReady ? (
                    <>
                      <video
                        ref={videoCallbackRef}
                        autoPlay
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                        style={{ transform: "scaleX(-1)" }}
                      />
                      {/* User name overlay */}
                      <div className="absolute bottom-16 left-4 rounded-lg bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                        <p className="text-sm font-medium text-white">
                          {user?.displayName || user?.email || "Bạn"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gray-800 text-5xl font-black text-gray-600">
                        {(user?.displayName?.[0] || user?.email?.[0] || "B").toUpperCase()}
                      </div>
                      <p className="text-base text-gray-500">Camera đã tắt</p>
                    </div>
                  )}
                </div>

                {/* Device controls */}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-6 pb-6 pt-14">
                  <button
                    type="button"
                    onClick={() => setEnableMic((v) => !v)}
                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                      enableMic
                        ? "bg-white/20 text-white backdrop-blur-md hover:bg-white/30"
                        : "bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600"
                    }`}
                  >
                    {enableMic ? <Mic size={22} /> : <MicOff size={22} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnableCamera((v) => !v)}
                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                      enableCamera
                        ? "bg-white/20 text-white backdrop-blur-md hover:bg-white/30"
                        : "bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600"
                    }`}
                  >
                    {enableCamera ? <Video size={22} /> : <VideoOff size={22} />}
                  </button>
                </div>
              </div>

              {/* Meeting title */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                  Tên cuộc họp
                </label>
                <input
                  type="text"
                  placeholder="Daily sync, Họp xử lý gấp..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-4 text-base font-medium text-gray-800 shadow-sm placeholder:text-gray-400 transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-primary-600"
                />
              </div>

              {/* Group selector */}
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                  Nhóm / Phòng ban
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500">
                    <FolderOpen size={18} />
                  </div>
                  <select
                    value={selectedGroupId}
                    onChange={(e) => {
                      setSelectedGroupId(e.target.value);
                      setSelectedParticipants([]);
                    }}
                    className="h-14 w-full appearance-none rounded-2xl border border-gray-200 bg-white pl-12 pr-12 text-sm font-medium text-gray-700 shadow-sm transition-all focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-primary-600"
                  >
                    {groups.length === 0 && <option value="">Chưa có nhóm</option>}
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500">
                    <ChevronDown size={18} />
                  </div>
                </div>
              </div>

              {/* AI Settings */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
                <div className="mb-4 flex items-center gap-2">
                  <Settings2 size={16} className="text-primary-500" />
                  <p className="text-sm font-bold text-gray-800 dark:text-slate-200">Cài đặt AI</p>
                </div>

                <div className="space-y-4">
                  {/* Language */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-500 dark:text-slate-400">
                      Ngôn ngữ chính
                    </label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 text-sm font-medium text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    >
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                      <option value="zh">中文</option>
                    </select>
                  </div>

                  {/* Always-on badge */}
                  <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3 dark:border-primary-900/30 dark:bg-primary-900/10">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
                      <Sparkles size={15} className="text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-primary-700 dark:text-primary-300">Ghi âm & AI tóm tắt</p>
                      <p className="text-[11px] text-primary-500 dark:text-primary-400">Tự động bật khi vào phòng</p>
                    </div>
                    <div className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary-500">
                      <Check size={12} strokeWidth={3} className="text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "members" && (
            <motion.div
              key="members"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-slate-700">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-900/20">
                      <UserPlus size={16} className="text-primary-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800 dark:text-slate-200">
                        Chọn thành viên tham gia
                      </p>
                      <p className="text-xs text-gray-400 dark:text-slate-500">
                        Bạn được thêm tự động
                      </p>
                    </div>
                  </div>
                  {selectedParticipants.length > 0 && (
                    <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-primary-500 px-2 text-xs font-bold text-white">
                      {selectedParticipants.length + 1}
                    </span>
                  )}
                </div>

                {/* Select all */}
                {members.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex w-full items-center gap-3 border-b border-gray-100 px-5 py-3 text-left transition hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
                  >
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-md border-2 transition ${
                        members.length > 0 && selectedParticipants.length === members.length
                          ? "border-primary-500 bg-primary-500 text-white"
                          : "border-gray-300 dark:border-slate-500"
                      }`}
                    >
                      {members.length > 0 && selectedParticipants.length === members.length && (
                        <Check size={12} strokeWidth={3} />
                      )}
                    </div>
                    <Users size={16} className="text-gray-400 dark:text-slate-500" />
                    <span className="text-sm font-semibold text-gray-600 dark:text-slate-300">
                      Chọn tất cả
                    </span>
                    <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                      {members.length}
                    </span>
                  </button>
                )}

                {/* Member list */}
                <div className="max-h-[400px] overflow-y-auto">
                  {loadingMembers ? (
                    <div className="flex items-center justify-center py-12 text-sm text-gray-400">
                      <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
                      Đang tải thành viên...
                    </div>
                  ) : members.length === 0 ? (
                    <div className="flex flex-col items-center py-12 text-center">
                      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-700">
                        <Users size={24} className="text-gray-300 dark:text-slate-500" />
                      </div>
                      <p className="text-sm font-medium text-gray-500 dark:text-slate-400">
                        Chưa có thành viên trong nhóm
                      </p>
                      <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                        Hãy thêm thành viên vào nhóm trước
                      </p>
                    </div>
                  ) : (
                    members.map((member) => {
                      const isSelected = selectedParticipants.includes(member.user_id);
                      return (
                        <button
                          key={member.user_id}
                          type="button"
                          onClick={() => toggleMember(member.user_id)}
                          className={`flex w-full items-center gap-4 px-5 py-3.5 text-left transition-all ${
                            isSelected
                              ? "bg-primary-50/60 dark:bg-primary-900/10"
                              : "hover:bg-gray-50 dark:hover:bg-slate-700/30"
                          }`}
                        >
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                              isSelected
                                ? "border-primary-500 bg-primary-500 text-white"
                                : "border-gray-300 dark:border-slate-500"
                            }`}
                          >
                            {isSelected && <Check size={12} strokeWidth={3} />}
                          </div>
                          <div className="relative shrink-0">
                            {member.avatar_url ? (
                              <img src={member.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-white dark:ring-slate-800" />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-sm font-bold text-gray-500 dark:from-slate-600 dark:to-slate-700 dark:text-slate-400">
                                {(member.name?.[0] || "?").toUpperCase()}
                              </div>
                            )}
                            {isSelected && (
                              <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800">
                                <Check size={8} strokeWidth={3} className="text-white" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-semibold ${isSelected ? "text-gray-900 dark:text-slate-100" : "text-gray-700 dark:text-slate-300"}`}>
                              {member.name}
                            </p>
                            {member.email && (
                              <p className="truncate text-xs text-gray-400 dark:text-slate-500">{member.email}</p>
                            )}
                          </div>
                          <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ${
                            isSelected
                              ? "bg-primary-100 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"
                              : "bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
                          }`}>
                            {member.role}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom bar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="sticky bottom-0 mt-6 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 lg:mx-0 lg:px-0"
        >
          <div className="flex items-center justify-end gap-2 pr-4">
            <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
              Hủy
            </Button>
            <Button
              type="submit"
              isLoading={isSubmitting}
              disabled={!selectedGroupId || groups.length === 0}
            >
              Tạo và vào phòng ngay
            </Button>
          </div>
        </motion.div>
      </form>
    </div>
  );
};

export default CreateMeeting;
