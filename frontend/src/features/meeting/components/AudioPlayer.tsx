/**
 * AudioPlayer Component
 * Trình phát âm thanh đơn giản với progress bar và controls
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface AudioPlayerProps {
  src?: string;
  onTimeUpdate?: (time: number) => void;
  onReady?: (isReady: boolean) => void;
}

export type AudioPlayerHandle = {
  seekTo: (time: number) => void;
  play: () => Promise<void>;
  pause: () => void;
};

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(({ src, onTimeUpdate, onReady }, ref) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.playbackRate = playbackRate;
      if ("preservesPitch" in audioRef.current) {
        (audioRef.current as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      }
    }
  }, [volume, isMuted, playbackRate]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1);
    setError(null);
    onReady?.(false);
  }, [src, onReady]);

  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      if (!audioRef.current) return;
      const nextTime = Number.isFinite(time) ? Math.max(0, time) : 0;
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      onTimeUpdate?.(nextTime);
    },
    play: async () => {
      if (!audioRef.current) return;
      await audioRef.current.play();
    },
    pause: () => {
      audioRef.current?.pause();
    },
  }), [onTimeUpdate]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error("Audio playback error:", error);
          });
        }
      }
    }
  };

  const onLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      onReady?.(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (onTimeUpdate) onTimeUpdate(audioRef.current.currentTime);
    }
  };

  const onEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    onTimeUpdate?.(0);
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      const nextTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, duration || audioRef.current.duration || Infinity));
      audioRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
      onTimeUpdate?.(nextTime);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    }
  };

  if (!src) return null;

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white/95 p-4 shadow-md backdrop-blur-md dark:border-slate-800/85 dark:bg-slate-900/95 transition-all">
      {error ? (
        <div className="flex items-center gap-3 py-3 text-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-red-600">{error}</p>
            <p className="mt-1 text-xs text-gray-400">Vui lòng thử tải lại trang</p>
          </div>
        </div>
      ) : (
        <>
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={onEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          const audio = e.currentTarget;
          const code = audio.error?.code;
          const msg = code === 4 ? 'Audio không hỗ trợ định dạng này'
            : code === 3 ? 'Lỗi decode audio'
            : code === 2 ? 'Lỗi tải audio từ server'
            : 'Không thể phát audio';
          setError(msg);
          console.error('Audio error:', audio.error, 'src:', audio.src);
        }}
        controls={false}
      />

      {/* Progress Bar */}
      <div className="mb-3 flex items-center gap-3">
        <span className="w-10 text-right text-xs font-medium text-gray-500">
          {formatTime(currentTime)}
        </span>
        <input
          type="range"
          min="0"
          max={duration || 100}
          step="0.1"
          value={currentTime}
          onChange={handleProgressChange}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-emerald-600"
          style={{
            background: `linear-gradient(to right, #10b981 ${(currentTime / (duration || 1)) * 100}%, #e5e7eb ${(currentTime / (duration || 1)) * 100}%)`
          }}
        />
        <span className="w-10 text-left text-xs font-medium text-gray-500">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Rate Selector */}
          <select
            value={playbackRate}
            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
            className="rounded bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 outline-none hover:bg-gray-200"
          >
            <option value="0.5">0.5x</option>
            <option value="1">1.0x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2.0x</option>
          </select>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => skip(-10)}
            className="rounded-full p-2 text-gray-600 transition hover:bg-gray-100"
            title="Lùi 10s"
          >
            <RotateCcw size={18} />
          </button>
          
          <button
            onClick={togglePlay}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 transition-all hover:scale-105 hover:bg-emerald-700 active:scale-95"
          >
            {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} className="ml-1" fill="currentColor" />}
          </button>

          <button
            onClick={() => skip(10)}
            className="rounded-full p-2 text-gray-600 transition hover:bg-gray-100"
            title="Tiến 10s"
          >
            <RotateCw size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="rounded-full p-2 text-gray-600 transition hover:bg-gray-100"
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="hidden h-1 w-16 cursor-pointer appearance-none rounded-full bg-gray-200 accent-emerald-600 sm:block"
            style={{
              background: `linear-gradient(to right, #10b981 ${volume * 100}%, #e5e7eb ${volume * 100}%)`
            }}
          />
        </div>
      </div>
        </>
      )}
    </div>
  );
});

export default AudioPlayer;
