import { useState, useRef, useCallback, useEffect } from "react";
import api from "../services/api";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  language?: string;
  confidence?: number;
}

interface LiveTranscript {
  id: string;
  userId?: string;
  chunkIndex: number;
  text: string;
  segments: TranscriptSegment[];
  timestamp: number;
}

interface WorkletChunkMessage {
  type: "chunk";
  samples: Float32Array;
  startMs: number;
  endMs: number;
  reason: string;
}

interface WorkletPCMMessage {
  type: "pcm";
  buffer: ArrayBuffer;
  sampleRate: number;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  liveTranscripts: LiveTranscript[];
  fullTranscript: string;
  allSegments: TranscriptSegment[];
  interimTranscript: string;
  sttStatus: "idle" | "connecting" | "streaming" | "fallback" | "error" | "closed";
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  finalize: (meetingId: string, language?: string) => Promise<any>;
  hydrateDraft: (meetingId: string) => Promise<void>;
  error: string | null;
}

const MAX_CHUNK_SECONDS = 8;
const SILENCE_THRESHOLD = 0.012;
const MIN_SPEECH_SECONDS = 0.4;
const PRE_ROLL_MS = 300;
const HANGOVER_MS = 1200;

const transcriptChunkKey = (userId: string | undefined, chunkIndex: number, fallback: string) =>
  `${userId || fallback}:${chunkIndex}`;

function resolveWebSocketBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  const baseURL = configured || window.location.origin;
  return baseURL.replace(/\/+$/, "").replace(/\/api$/i, "").replace(/^http/, "ws");
}

function getAuthToken(): string {
  const sessionStr = localStorage.getItem("session");
  try {
    return sessionStr ? JSON.parse(sessionStr)?.token || "" : "";
  } catch {
    return "";
  }
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples (float32 -> int16)
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function useAudioRecorder(
  localStream: MediaStream | null,
  meetingId: string | null
): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveTranscript[]>([]);
  const [fullTranscript, setFullTranscript] = useState("");
  const [allSegments, setAllSegments] = useState<TranscriptSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [sttStatus, setSttStatus] = useState<UseAudioRecorderReturn["sttStatus"]>("idle");
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const chunkCounterRef = useRef(0);
  const pendingChunksRef = useRef(0);
  const flushResolverRef = useRef<(() => void) | null>(null);
  const fullTranscriptRef = useRef("");
  const allSegmentsRef = useRef<TranscriptSegment[]>([]);
  const chunksByIndexRef = useRef<Map<string, LiveTranscript>>(new Map());
  const segmentsByIndexRef = useRef<Map<string, TranscriptSegment[]>>(new Map());
  const sampleRateRef = useRef(16000);
  const sttSocketRef = useRef<WebSocket | null>(null);
  const fallbackModeRef = useRef(false);
  const intentionalCloseRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sttSocketRef.current?.close();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, []);

  const rebuildTranscriptState = useCallback(() => {
    const orderedTranscripts = Array.from(chunksByIndexRef.current.values()).sort(
      (a, b) => a.chunkIndex - b.chunkIndex || a.timestamp - b.timestamp
    );
    const orderedSegments = orderedTranscripts.flatMap((item) => item.segments);
    const nextFullTranscript = orderedTranscripts.map((item) => item.text).join("\n");

    fullTranscriptRef.current = nextFullTranscript;
    allSegmentsRef.current = orderedSegments;
    setLiveTranscripts(orderedTranscripts);
    setFullTranscript(nextFullTranscript);
    setAllSegments(orderedSegments);
  }, []);

  const mergeTranscriptChunk = useCallback((rawChunk: any, fallbackSource = "local") => {
    const chunkIndex = Number(rawChunk.chunkIndex ?? rawChunk.chunk_index ?? chunkCounterRef.current++);
    const segments = Array.isArray(rawChunk.segments) ? rawChunk.segments : [];
    const normalizedSegments = segments.map((segment: TranscriptSegment) => ({
      ...segment,
      language: segment.language || rawChunk.language || "auto",
    }));
    const text = String(rawChunk.text || normalizedSegments.map((segment) => segment.text).filter(Boolean).join(" ")).trim();
    if (!text) return;
    const transcript: LiveTranscript = {
      id: rawChunk.id || `${fallbackSource}_${chunkIndex}_${Date.now()}`,
      userId: rawChunk.user_id || rawChunk.userId,
      chunkIndex,
      text,
      segments: normalizedSegments.length > 0 ? normalizedSegments : [{
        start: 0,
        end: 0,
        text,
        speaker: rawChunk.speaker,
        language: rawChunk.language || "auto",
      }],
      timestamp: rawChunk.timestamp ? new Date(rawChunk.timestamp).getTime() : Date.now(),
    };
    const key = transcriptChunkKey(transcript.userId, chunkIndex, fallbackSource);
    chunksByIndexRef.current.set(key, transcript);
    segmentsByIndexRef.current.set(key, transcript.segments);
    setInterimTranscript("");
    rebuildTranscriptState();
  }, [rebuildTranscriptState]);

  const sendChunkToBackend = useCallback(
    async (blob: Blob, chunkIndex: number, startMs: number) => {
      if (!meetingId) return;

      pendingChunksRef.current++;
      const maxRetries = 3;
      const formData = new FormData();
      formData.append("audio", blob, `chunk_${chunkIndex}.wav`);
      formData.append("chunk_index", String(chunkIndex));
      formData.append("start_ms", String(startMs || 0));

      try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const response = await api.post(
              `/api/meetings/${meetingId}/transcribe-chunk`,
              formData,
              {
                headers: { "Content-Type": "multipart/form-data" },
                timeout: 120000,
              }
            );

            const { text, segments, language } = response.data;

            if (text && text.trim()) {
              const normalizedSegments = (segments || []).map((segment: TranscriptSegment) => ({
                ...segment,
                start: segment.start + startMs / 1000,
                end: segment.end + startMs / 1000,
                language: segment.language || language || "auto",
              }));
              mergeTranscriptChunk({
                id: response.data?.id || `chunk_${chunkIndex}_${Date.now()}`,
                user_id: response.data?.user_id || response.data?.userId,
                chunkIndex,
                text: text.trim(),
                segments: normalizedSegments,
                timestamp: Date.now(),
              }, "local");
            }
            break;
          } catch (err: any) {
            const isLastAttempt = attempt === maxRetries;
            console.error(
              `Chunk ${chunkIndex} transcription failed (attempt ${attempt}/${maxRetries}):`,
              err
            );
            if (isLastAttempt) {
              setError(
                `Chunk ${chunkIndex} failed after ${maxRetries} attempts: ${err.response?.data?.detail || err.message}`
              );
            } else {
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
          }
        }
      } finally {
        pendingChunksRef.current--;
      }
    },
    [meetingId, mergeTranscriptChunk]
  );

  const startChunkRecording = useCallback(async (preserveTranscriptState = false) => {
    if (!localStream) {
      setError("No audio stream available");
      return;
    }

    setError(null);
    if (!preserveTranscriptState) {
      chunkCounterRef.current = 0;
      fullTranscriptRef.current = "";
      allSegmentsRef.current = [];
      chunksByIndexRef.current.clear();
      segmentsByIndexRef.current.clear();
      setLiveTranscripts([]);
      setFullTranscript("");
      setAllSegments([]);
      setInterimTranscript("");
    } else {
      chunkCounterRef.current = Array.from(chunksByIndexRef.current.values()).reduce(
        (maxIndex, item) => Math.max(maxIndex, item.chunkIndex),
        -1,
      ) + 1;
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass({ sampleRate: 16000 });
      sampleRateRef.current = audioContext.sampleRate;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Load AudioWorklet processor
      await audioContext.audioWorklet.addModule("/audio-processor.js");

      const source = audioContext.createMediaStreamSource(localStream);

      // Highpass filter for noise reduction
      const highpass = audioContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      highpass.Q.value = 0.7;

      // AudioWorkletNode for PCM capture
      const workletNode = new AudioWorkletNode(audioContext, "audio-processor");

      workletNode.port.onmessage = (event) => {
        const data = event.data as WorkletChunkMessage;
        if (!data || data.type !== "chunk") return;
        const pcmSamples = data.samples;
        const chunkIndex = chunkCounterRef.current++;
        const wavBlob = encodeWAV(pcmSamples, sampleRateRef.current);
        sendChunkToBackend(wavBlob, chunkIndex, data.startMs || 0);
        if (data.reason === "manual" && flushResolverRef.current) {
          flushResolverRef.current();
          flushResolverRef.current = null;
        }
      };
      workletNode.port.postMessage({
        type: "config",
        config: {
          silenceThreshold: SILENCE_THRESHOLD,
          minSpeechSeconds: MIN_SPEECH_SECONDS,
          maxChunkSeconds: MAX_CHUNK_SECONDS,
          preRollMs: PRE_ROLL_MS,
          hangoverMs: HANGOVER_MS,
        },
      });

      // Connect: source -> highpass -> workletNode
      source.connect(highpass);
      highpass.connect(workletNode);

      audioContextRef.current = audioContext;
      sourceNodeRef.current = source;
      filterNodeRef.current = highpass;
      workletNodeRef.current = workletNode;

      setIsRecording(true);
      setSttStatus("fallback");
      console.log(
        `AudioWorklet fallback recording started, silence-only chunks at ${audioContext.sampleRate}Hz`
      );
    } catch (err: any) {
      console.error("Failed to start AudioWorklet recording:", err);
      setError(`Failed to start recording: ${err.message}`);
      setSttStatus("error");
    }
  }, [localStream, sendChunkToBackend]);

  const setupStreamingAudio = useCallback(async (ws: WebSocket) => {
    if (!localStream) {
      throw new Error("No audio stream available");
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContextClass({ sampleRate: 16000 });
    sampleRateRef.current = audioContext.sampleRate;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    await audioContext.audioWorklet.addModule("/pcm-stream-processor.js");

    ws.send(JSON.stringify({
      type: "stt.config",
      sampleRate: sampleRateRef.current,
      language: "vi",
    }));

    const source = audioContext.createMediaStreamSource(localStream);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;
    const workletNode = new AudioWorkletNode(audioContext, "pcm-stream-processor");
    workletNode.port.postMessage({ type: "config", frameMs: 200 });
    workletNode.port.onmessage = (event) => {
      const data = event.data as WorkletPCMMessage;
      if (!data || data.type !== "pcm") return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data.buffer);
      }
    };

    source.connect(highpass);
    highpass.connect(workletNode);

    audioContextRef.current = audioContext;
    sourceNodeRef.current = source;
    filterNodeRef.current = highpass;
    workletNodeRef.current = workletNode;
  }, [localStream]);

  const startRecording = useCallback(async () => {
    if (!localStream || !meetingId) {
      setError("No audio stream available");
      return;
    }

    setError(null);
    setSttStatus("connecting");
    setInterimTranscript("");
    fallbackModeRef.current = false;
    intentionalCloseRef.current = false;
    chunkCounterRef.current = 0;
    fullTranscriptRef.current = "";
    allSegmentsRef.current = [];
    chunksByIndexRef.current.clear();
    segmentsByIndexRef.current.clear();
    setLiveTranscripts([]);
    setFullTranscript("");
    setAllSegments([]);

    const wsUrl = `${resolveWebSocketBaseUrl()}/api/meetings/${meetingId}/stt-stream?token=${encodeURIComponent(getAuthToken())}`;
    let ws = new WebSocket(wsUrl);
    sttSocketRef.current = ws;
    let resolveStart: (() => void) | null = null;
    let currentWs = ws;

    const startFallback = async (message?: string) => {
      if (fallbackModeRef.current) return;
      fallbackModeRef.current = true;
      try {
        currentWs.close();
      } catch {}
      setSttStatus("fallback");
      if (message) setError(message);
      await startChunkRecording(true);
    };

    const bindWsHandlers = (socket: WebSocket) => {
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "stt.status") {
            setSttStatus(data.status || "streaming");
            if (data.status === "fallback") {
              startFallback(data.reason || "Realtime streaming chưa khả dụng, đang dùng fallback silence-only.");
            } else if (data.status === "error") {
              const errorMsg = data.error || "Realtime STT lỗi";
              console.warn("STT stream error from backend:", errorMsg);
              startFallback(`STT streaming lỗi: ${errorMsg}. Đang dùng fallback.`);
            }
          } else if (data.type === "transcript.interim") {
            setInterimTranscript(String(data.text || ""));
          } else if (data.type === "transcript.chunk") {
            mergeTranscriptChunk(data, "stream");
          }
        } catch (err) {
          console.error("Failed to parse STT stream event:", err);
        }
      };

      socket.onclose = (event) => {
        if (intentionalCloseRef.current) return; // stopRecording initiated this close
        if (!fallbackModeRef.current) {
          // Unexpected close while recording → auto-fallback
          console.warn(`WebSocket closed unexpectedly (code=${event.code}), falling back to chunk recording`);
          startFallback("Kết nối realtime STT bị gián đoạn, chuyển sang fallback.");
        }
      };
    };

    let retriedOnce = false;
    const handleError = (event: Event) => {
      console.error("WebSocket error:", event);
      if (!retriedOnce) {
        retriedOnce = true;
        console.log("Retrying WebSocket connection once...");
        try { currentWs.close(); } catch {}
        // Actually retry: create a new WebSocket
        const retryWs = new WebSocket(wsUrl);
        currentWs = retryWs;
        sttSocketRef.current = retryWs;
        bindWsHandlers(retryWs);
        retryWs.onerror = handleError;
        retryWs.onopen = async () => {
          ws = retryWs;
          window.clearTimeout(timer);
          try {
            await setupStreamingAudio(retryWs);
            setIsRecording(true);
            setSttStatus("streaming");
          } catch (err: any) {
            await startFallback(err.message || "Không khởi tạo được realtime STT.");
          }
          resolveStart?.();
        };
      } else {
        startFallback("Không nối được realtime STT, đang dùng fallback silence-only.").finally(() => {
          resolveStart?.();
        });
      }
    };
    ws.onerror = handleError;
    bindWsHandlers(ws);

    let timer: number;
    await new Promise<void>((resolve) => {
      resolveStart = resolve;
      timer = window.setTimeout(() => {
        startFallback("Realtime STT timeout, đang dùng fallback silence-only.").finally(resolve);
      }, 3000);
      ws.onopen = async () => {
        window.clearTimeout(timer);
        try {
          await setupStreamingAudio(ws);
          setIsRecording(true);
          setSttStatus("streaming");
        } catch (err: any) {
          await startFallback(err.message || "Không khởi tạo được realtime STT.");
        }
        resolve();
      };
    });
  }, [localStream, meetingId, mergeTranscriptChunk, setupStreamingAudio, startChunkRecording]);

  const flushRecording = useCallback(async () => {
    if (!workletNodeRef.current) return;

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        if (flushResolverRef.current) {
          flushResolverRef.current = null;
          resolve();
        }
      }, 1200);
      flushResolverRef.current = () => {
        window.clearTimeout(timer);
        resolve();
      };
      workletNodeRef.current?.port.postMessage({ type: "flush" });
    });
  }, []);

  const stopRecording = useCallback(async () => {
    intentionalCloseRef.current = true;

    if (fallbackModeRef.current) {
      await flushRecording();
    } else if (sttSocketRef.current?.readyState === WebSocket.OPEN) {
      const ws = sttSocketRef.current;

      // Send finalize and wait for backend to confirm all chunks saved
      ws.send(JSON.stringify({ type: "stt.finalize" }));
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3000); // 3s safety timeout
        const onMsg = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "stt.status" && data.status === "closed") {
              clearTimeout(timeout);
              ws.removeEventListener("message", onMsg);
              resolve();
            }
          } catch {}
        };
        ws.addEventListener("message", onMsg);
      });

      // Send close signal
      try {
        ws.send(JSON.stringify({ type: "stt.close" }));
        await new Promise((r) => setTimeout(r, 200));
      } catch {}
    }

    // Now safely close WebSocket - onclose handler will see intentionalCloseRef=true
    try { sttSocketRef.current?.close(); } catch {}
    sttSocketRef.current = null;

    // Disconnect worklet node
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Disconnect source
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (filterNodeRef.current) {
      filterNodeRef.current.disconnect();
      filterNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsRecording(false);
    setInterimTranscript("");
    setSttStatus(fallbackModeRef.current ? "fallback" : "closed");
    console.log("Recording stopped");
  }, [flushRecording]);

  const finalize = useCallback(
    async (finalizeMeetingId: string) => {
      try {
        await stopRecording();

        // Wait for all pending chunks to finish (max 60s)
        const maxWait = 60000;
        const startTime = Date.now();
        while (pendingChunksRef.current > 0 && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (pendingChunksRef.current > 0) {
          console.warn(
            `${pendingChunksRef.current} chunks still pending after ${maxWait / 1000}s`
          );
        }

        const response = await api.post(
          `/api/meetings/${finalizeMeetingId}/finalize`,
          {
            transcript: fullTranscriptRef.current,
            segments: allSegmentsRef.current,
          },
          { timeout: 120000 }
        );

        return response.data;
      } catch (err: any) {
        console.error("Finalize failed:", err);
        setError(`Finalize failed: ${err.response?.data?.detail || err.message}`);
        throw err;
      }
    },
    [stopRecording]
  );

  const hydrateDraft = useCallback(async (draftMeetingId: string) => {
    try {
      const response = await api.get(`/api/meetings/${draftMeetingId}/transcript-draft`);
      const chunks = Array.isArray(response.data?.chunks) ? response.data.chunks : [];
      chunksByIndexRef.current.clear();
      segmentsByIndexRef.current.clear();

      chunks.forEach((chunk: any) => {
        const chunkIndex = Number(chunk.chunkIndex ?? chunk.chunk_index ?? 0);
        const normalizedSegments = (chunk.segments || []).map((segment: any) => ({
          start: Number(segment.start ?? segment.start_time ?? 0),
          end: Number(segment.end ?? segment.end_time ?? 0),
          text: segment.text || "",
          speaker: segment.speaker || segment.speaker_label || "Speaker_01",
          language: segment.language || chunk.language || "auto",
          confidence: segment.confidence ?? segment.confidence_score,
        }));
        const userId = chunk.userId || chunk.user_id;
        const key = transcriptChunkKey(userId, chunkIndex, chunk.id || "draft");
        chunksByIndexRef.current.set(key, {
          id: chunk.id || `draft_${chunkIndex}`,
          userId,
          chunkIndex,
          text: chunk.text || "",
          segments: normalizedSegments,
          timestamp: chunk.timestamp ? new Date(chunk.timestamp).getTime() : Date.now(),
        });
        segmentsByIndexRef.current.set(key, normalizedSegments);
      });

      rebuildTranscriptState();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Không thể khôi phục transcript nháp");
    }
  }, [rebuildTranscriptState]);

  return {
    isRecording,
    liveTranscripts,
    fullTranscript,
    allSegments,
    interimTranscript,
    sttStatus,
    startRecording,
    stopRecording,
    finalize,
    hydrateDraft,
    error,
  };
}
