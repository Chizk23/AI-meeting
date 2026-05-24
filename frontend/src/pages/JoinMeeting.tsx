/**
 * JoinMeeting - Tham gia cuộc họp bằng mã hoặc QR
 */
import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Keyboard, Camera } from "lucide-react";
import { Card, Button, Input, showToast } from "../components/ui";
import api from "../services/api";
import { normalizeMeetingDetail } from "../services/mappers";
import { getMeetingJoinState } from "../utils/meetingFlow";

const JoinMeeting: React.FC = () => {
  const navigate = useNavigate();
  const { code: urlCode } = useParams<{ code?: string }>();
  const [code, setCode] = useState(urlCode || "");
  const [mode, setMode] = useState<"code" | "qr">("code");
  const [isChecking, setIsChecking] = useState(false);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      showToast.error("Vui lòng nhập mã tham gia");
      return;
    }
    setIsChecking(true);
    try {
      const response = await api.get(`/api/meetings/by-code/${trimmed}`);
      const meeting = normalizeMeetingDetail(response.data);
      const joinState = getMeetingJoinState(meeting);
      if (!joinState.canJoin) {
        showToast.error(joinState.reason || "Chưa thể tham gia cuộc họp này");
        return;
      }
      navigate(joinState.href, {
        state: {
          title: meeting.title,
          enableCamera: true,
          enableMic: true,
          enableRecord: true,
          participants: meeting.attendees,
        },
      });
    } catch {
      showToast.error("Mã tham gia không hợp lệ hoặc bạn không có quyền vào phòng");
    } finally {
      setIsChecking(false);
    }
  };

  React.useEffect(() => {
    if (urlCode) {
      setCode(urlCode);
    }
  }, [urlCode]);

  return (
    <div className="app-bg flex min-h-screen items-center justify-center px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <Card className="text-center">
          <div className="mb-6">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-900/30">
              <Keyboard size={28} className="text-primary-600 dark:text-primary-300" />
            </div>
            <h1 className="text-h2 text-gray-900 dark:text-slate-100">Tham gia cuộc họp</h1>
            <p className="mt-1 text-body text-gray-500">Nhập mã tham gia hoặc quét QR</p>
          </div>

          {/* Mode Toggle */}
          <div className="mb-6 flex rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
            <button
              onClick={() => setMode("code")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition ${
                mode === "code"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-gray-500 dark:text-slate-400"
              }`}
            >
              <Keyboard size={16} />
              Nhập mã
            </button>
            <button
              onClick={() => setMode("qr")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition ${
                mode === "qr"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-gray-500 dark:text-slate-400"
              }`}
            >
              <Camera size={16} />
              Quét QR
            </button>
          </div>

          {mode === "code" ? (
            <div className="space-y-4">
              <Input
                placeholder="VD: ABC-DEF-GHI"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                className="text-center font-mono text-lg tracking-widest"
              />
              <Button
                onClick={handleJoin}
                className="w-full"
                size="lg"
                isLoading={isChecking}
                icon={<ArrowRight size={18} />}
              >
                Tham gia
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-800">
                <div className="text-center">
                  <Camera size={40} className="mx-auto text-gray-400" />
                  <p className="mt-2 text-caption text-gray-500">
                    Tính năng đang phát triển
                  </p>
                </div>
              </div>
              <p className="text-caption text-gray-500">
                Vui lòng sử dụng chế độ nhập mã để tham gia
              </p>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-gray-400 dark:text-slate-500">
            Hoặc truy cập{" "}
            <button
              onClick={() => navigate("/create")}
              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              tạo cuộc họp mới
            </button>
          </p>
        </Card>
      </motion.div>
    </div>
  );
};

export default JoinMeeting;
