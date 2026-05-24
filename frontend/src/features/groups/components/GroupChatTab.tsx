/**
 * GroupChatTab - Tab thảo luận nội bộ trong Nhóm
 * - Không có reaction/emoji
 * - Hỗ trợ @mention
 * - Chống gửi trùng tin nhắn
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Pin,
  MessageSquare,
  Trash2,
  Reply,
  X,
  AtSign,
} from 'lucide-react';
import { useGroupStore } from '../../../stores';
import { useAuth } from '../../../context/AuthContext';
import { toast } from '../../../components/ui/Toast';
import api from '../../../services/api';
import type { GroupMessage, User } from '../../../types';
import { normalizeGroupMessage } from '../../../services/mappers';

interface GroupChatTabProps {
  groupId: string;
}

function clsx(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

const GroupChatTab: React.FC<GroupChatTabProps> = ({ groupId }) => {
  const { members } = useGroupStore();
  const { user: currentUser } = useAuth();
  const [messageText, setMessageText] = useState('');
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // @mention state
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const currentUserId = currentUser?.id;
  const chatReadKey = `group_chat_last_read_by_user_${currentUserId || 'anonymous'}`;

  // Load messages + poll for new ones
  useEffect(() => {
    if (!groupId) return;

    const fetchMessages = async (showLoading = true) => {
      if (showLoading) setIsLoading(true);
      try {
        const response = await api.get(`/api/groups/${groupId}/messages`);
        const fetched = Array.isArray(response.data) ? response.data.map(normalizeGroupMessage) : [];
        setMessages((prev) => {
          // Only update if there are new messages
          if (fetched.length !== prev.length || (fetched.length > 0 && fetched[fetched.length - 1].id !== prev[prev.length - 1]?.id)) {
            return fetched;
          }
          return prev;
        });
      } catch {
        if (showLoading) toast.error('Không thể tải tin nhắn');
      } finally {
        if (showLoading) setIsLoading(false);
      }
    };

    fetchMessages(true);
    const interval = setInterval(() => fetchMessages(false), 10000);
    return () => clearInterval(interval);
  }, [groupId]);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Mark read
  useEffect(() => {
    if (!groupId || !currentUserId) return;
    const latest = messages[messages.length - 1];
    const raw = localStorage.getItem(chatReadKey);
    const readMap = raw ? JSON.parse(raw) : {};
    readMap[groupId] = latest?.created_at || latest?.createdAt || new Date().toISOString();
    localStorage.setItem(chatReadKey, JSON.stringify(readMap));
  }, [chatReadKey, currentUserId, groupId, messages]);

  // Filtered members for @mention
  const filteredMembers = members.filter((m) => {
    if (!mentionQuery) return true;
    const name = (m.displayName || m.email || '').toLowerCase();
    return name.includes(mentionQuery.toLowerCase());
  });

  // Handle @mention detection in input
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageText(val);

    // Detect @mention
    const cursorPos = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentionList(true);
      setMentionIndex(0);
    } else {
      setShowMentionList(false);
    }
  };

  // Insert @mention
  const insertMention = useCallback((member: Partial<User>) => {
    const name = member.displayName || member.email?.split('@')[0] || 'user';
    const cursorPos = textareaRef.current?.selectionStart || messageText.length;
    const textBeforeCursor = messageText.slice(0, cursorPos);
    const textAfterCursor = messageText.slice(cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    const newText = textBeforeCursor.slice(0, atIndex) + `@${name} ` + textAfterCursor;
    setMessageText(newText);
    setShowMentionList(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [messageText]);

  // Send message (with duplicate prevention)
  const handleSendMessage = useCallback(async () => {
    const text = messageText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    try {
      const payload: { text: string; reply_to_id?: string } = { text };
      if (replyingTo) {
        payload.reply_to_id = replyingTo.id;
      }
      const response = await api.post(`/api/groups/${groupId}/messages`, payload);
      const newMessage = normalizeGroupMessage(response.data);
      setMessages((prev) => [...prev, newMessage]);
      setMessageText('');
      setReplyingTo(null);
    } catch {
      toast.error('Không thể gửi tin nhắn');
    } finally {
      setIsSending(false);
    }
  }, [messageText, isSending, groupId, replyingTo]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    // Handle @mention navigation
    if (showMentionList && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMembers[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionList(false);
        return;
      }
    }

    // Send on Enter (no Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
    }
  };

  const handlePin = async (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;
    try {
      const response = await api.patch(`/api/groups/messages/${messageId}`, {
        is_pinned: !msg.is_pinned,
      });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? normalizeGroupMessage(response.data) : m)));
      toast.success(msg.is_pinned ? 'Đã bỏ ghim' : 'Đã ghim tin nhắn');
    } catch {
      toast.error('Không thể ghim tin nhắn');
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!window.confirm('Bạn có chắc muốn xóa tin nhắn này?')) return;
    try {
      await api.delete(`/api/groups/messages/${messageId}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      toast.success('Đã xóa tin nhắn');
    } catch {
      toast.error('Không thể xóa tin nhắn');
    }
  };

  const getUserById = (userId: string): Partial<User> => {
    return members.find((u) => u.id === userId) || { id: userId, displayName: 'Thành viên', email: '' };
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hôm nay';
    if (date.toDateString() === yesterday.toDateString()) return 'Hôm qua';
    return date.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  // Render text with @mention highlighted
  const renderMessageText = (text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="font-semibold text-primary-500 dark:text-primary-400">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const groupedMessages = messages.reduce((acc, msg) => {
    const dateLabel = formatDateLabel(msg.created_at || new Date().toISOString());
    if (!acc[dateLabel]) acc[dateLabel] = [];
    acc[dateLabel].push(msg);
    return acc;
  }, {} as Record<string, GroupMessage[]>);

  const pinnedMessages = messages.filter((m) => m.is_pinned);

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[650px]">
      {/* Pinned Messages */}
      <AnimatePresence>
        {pinnedMessages.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mb-3 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Pin size={12} />
                Ghim ({pinnedMessages.length})
              </div>
            </div>
            {pinnedMessages.slice(0, 1).map((msg) => (
              <div key={msg.id} className="flex items-center justify-between">
                <p className="text-sm text-amber-800 dark:text-amber-200 truncate">
                  {msg.text}
                </p>
                <button onClick={() => handlePin(msg.id)} className="ml-2 text-amber-400 hover:text-amber-600">
                  <X size={14} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 pr-2 scroll-smooth">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 rounded-full bg-gray-100 p-5 dark:bg-slate-800">
              <MessageSquare size={36} className="text-gray-300 dark:text-slate-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-700 dark:text-slate-200">Chưa có thảo luận</h3>
            <p className="mt-1 text-sm text-gray-400">Hãy bắt đầu cuộc hội thoại đầu tiên.</p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([dateLabel, msgs]) => (
            <div key={dateLabel} className="space-y-4">
              {/* Date Divider */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
                <span className="text-[11px] font-medium text-gray-400 dark:text-slate-500">
                  {dateLabel}
                </span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
              </div>

              {msgs.map((msg) => {
                const msgUser = msg.user || getUserById(msg.user_id || '');
                const isCurrentUser = msg.user_id === currentUserId;

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={clsx('flex gap-2.5', isCurrentUser && 'flex-row-reverse')}
                  >
                    {/* Avatar */}
                    <div className="shrink-0 mt-1">
                      <div className={clsx(
                        'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                        isCurrentUser
                          ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'
                      )}>
                        {(msgUser?.displayName?.[0] || msgUser?.username?.[0] || 'U').toUpperCase()}
                      </div>
                    </div>

                    {/* Content */}
                    <div className={clsx('group max-w-[75%]', isCurrentUser && 'items-end')}>
                      {!isCurrentUser && (
                        <p className="mb-1 ml-1 text-xs font-medium text-gray-500 dark:text-slate-400">
                          {msgUser?.displayName || msgUser?.username || 'Thành viên'}
                        </p>
                      )}

                      <div className="relative">
                        <div className={clsx(
                          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                          isCurrentUser
                            ? 'bg-primary-600 text-white rounded-tr-md'
                            : 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-100 rounded-tl-md'
                        )}>
                          {/* Reply Quote */}
                          {(msg.replyTo || msg.reply_to) && (
                            <div className={clsx(
                              'mb-2 rounded-lg px-3 py-2 text-xs border-l-2',
                              isCurrentUser
                                ? 'bg-primary-700/50 border-primary-300 text-primary-100'
                                : 'bg-gray-200/60 dark:bg-slate-700/60 border-gray-400 dark:border-slate-500 text-gray-500 dark:text-slate-400'
                            )}>
                              <p className="font-semibold mb-0.5">
                                {(msg.replyTo || msg.reply_to)?.user?.displayName || 'Thành viên'}
                              </p>
                              <p className="truncate opacity-80">
                                {(msg.replyTo || msg.reply_to)?.text}
                              </p>
                            </div>
                          )}
                          {renderMessageText(msg.text)}
                        </div>

                        {/* Hover Actions */}
                        <div className={clsx(
                          'absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity',
                          isCurrentUser ? 'right-full mr-2' : 'left-full ml-2'
                        )}>
                          <button
                            onClick={() => setReplyingTo(msg)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                            title="Trả lời"
                          >
                            <Reply size={14} />
                          </button>
                          <button
                            onClick={() => handlePin(msg.id)}
                            className={clsx(
                              'rounded-md p-1.5 transition-colors',
                              msg.is_pinned
                                ? 'text-amber-500 hover:text-amber-600'
                                : 'text-gray-400 hover:bg-gray-100 hover:text-amber-500 dark:hover:bg-slate-700'
                            )}
                            title={msg.is_pinned ? 'Bỏ ghim' : 'Ghim'}
                          >
                            <Pin size={14} />
                          </button>
                          {isCurrentUser && (
                            <button
                              onClick={() => handleDelete(msg.id)}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                              title="Xóa"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Time */}
                      <div className={clsx(
                        'mt-1 flex items-center gap-1 px-1 text-[10px] text-gray-400',
                        isCurrentUser && 'justify-end'
                      )}>
                        {msg.is_pinned && <Pin size={9} className="text-amber-500" />}
                        <span>{formatTime(msg.created_at || '')}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="mt-4 relative">
        {/* Reply Preview */}
        <AnimatePresence>
          {replyingTo && (
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              className="mb-2 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2 dark:bg-slate-800 border border-gray-200 dark:border-slate-700"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Reply size={14} className="text-primary-500 shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                    {getUserById(replyingTo.user_id || '').displayName || replyingTo.user?.username}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 truncate">{replyingTo.text}</span>
                </div>
              </div>
              <button onClick={() => setReplyingTo(null)} className="shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700">
                <X size={14} className="text-gray-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* @mention dropdown */}
        <AnimatePresence>
          {showMentionList && filteredMembers.length > 0 && (
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              className="absolute bottom-full left-0 right-0 mb-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 z-20"
            >
              {filteredMembers.slice(0, 8).map((member, idx) => (
                <button
                  key={member.id}
                  onClick={() => insertMention(member)}
                  className={clsx(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    idx === mentionIndex
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-slate-700'
                  )}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                    {(member.displayName?.[0] || member.email?.[0] || 'U').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">
                      {member.displayName || member.email}
                    </p>
                    {member.email && member.displayName && (
                      <p className="text-xs text-gray-400 truncate">{member.email}</p>
                    )}
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Box */}
        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100 dark:focus-within:ring-primary-900/30 transition-all">
          <button
            onClick={() => {
              setMessageText((prev) => prev + '@');
              setShowMentionList(true);
              setMentionQuery('');
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700"
            title="Gắn tên (@)"
          >
            <AtSign size={18} />
          </button>
          <textarea
            ref={textareaRef}
            value={messageText}
            onChange={handleTextChange}
            onKeyDown={handleKeyPress}
            placeholder="Nhập tin nhắn... (dùng @ để gắn tên)"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-400 dark:text-slate-100 min-h-[28px] max-h-[120px]"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim() || isSending}
            className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 text-white transition-all hover:bg-primary-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] text-gray-400">
          <kbd className="rounded bg-gray-100 px-1 dark:bg-slate-700">Enter</kbd> gửi &middot;{' '}
          <kbd className="rounded bg-gray-100 px-1 dark:bg-slate-700">Shift+Enter</kbd> xuống dòng &middot;{' '}
          <kbd className="rounded bg-gray-100 px-1 dark:bg-slate-700">@</kbd> gắn tên
        </p>
      </div>
    </div>
  );
};

export default GroupChatTab;
