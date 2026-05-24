/**
 * Trang Thông báo - kết nối với API thật
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  CheckCheck,
  AlertCircle,
  FileText,
  MessageSquare,
  UserPlus,
  Clock,
  X,
  Settings,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useOrgStore } from '../../../stores';
import api from '../../../services/api';
import { PageState } from '../../../components/ui';

type NotificationType = 'meeting' | 'mention' | 'system' | 'user' | 'invitation';
type NotificationPriority = 'urgent' | 'today' | 'recent';
type NotificationFilter = 'all' | NotificationType;

interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
  actions?: Array<{ label: string; variant: 'primary' | 'secondary'; onClick?: () => void }>;
  metadata?: {
    dueDate?: string;
    assignedBy?: string;
    entity_type?: 'meeting' | 'task' | 'group' | 'invitation' | 'system';
    meeting_id?: string;
    invitationId?: string;
    organization_id?: string;
    organizationName?: string;
    role?: string;
    task_id?: string;
    group_id?: string;
    action_label?: string;
    [key: string]: unknown;
  };
}

const Notifications: React.FC = () => {
  const navigate = useNavigate();
  const { session, refreshUser } = useAuth();
  const { setCurrentOrg } = useOrgStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<NotificationFilter>('all');
  const [showSettings, setShowSettings] = useState(false);

  const resolveNotificationRoute = useCallback(
    (notification: Notification) => {
      const metadata = notification.metadata || {};
      const meetingId = metadata.meeting_id;
      const groupId = metadata.group_id;
      const taskId = metadata.task_id;

      if (meetingId && taskId) {
        return {
          to: `/meetings/${meetingId}`,
          state: { initialTab: 'actions' as const },
          label: metadata.action_label || 'Mở việc',
        };
      }
      if (meetingId) {
        return {
          to: `/meetings/${meetingId}`,
          label: metadata.action_label || 'Mở cuộc họp',
        };
      }
      if (groupId) {
        return {
          to: `/groups/${groupId}`,
          label: metadata.action_label || 'Mở nhóm',
        };
      }
      if (taskId) {
        return {
          to: '/actions',
          label: metadata.action_label || 'Mở việc',
        };
      }
      return null;
    },
    [],
  );

  const fetchNotifications = useCallback(async (showLoading = false) => {
    if (!session?.token) {
      setLoading(false);
      return;
    }
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await api.get('/api/notifications');
      const mapped: Notification[] = res.data.map((n: any) => {
        const metadata = n.metadata || {};
        return {
          ...n,
          metadata,
          timestamp: new Date(n.timestamp),
          actions:
            n.type === 'invitation'
              ? [
                  {
                    label: 'Chấp nhận',
                    variant: 'primary' as const,
                    onClick: async () => {
                      const invitationId = metadata.invitationId;
                      const organizationId = metadata.organization_id;
                      if (!invitationId) return;

                      await api.post(`/api/invitations/${invitationId}/accept`);
                      await refreshUser();
                      if (organizationId) {
                        setCurrentOrg(organizationId);
                      }
                      await api.patch(`/api/notifications/${n.id}/read`);
                      setNotifications((prev) => prev.filter((item) => item.id !== n.id));
                      navigate('/dashboard');
                    },
                  },
                  {
                    label: 'Ẩn',
                    variant: 'secondary' as const,
                    onClick: async () => {
                      await api.delete(`/api/notifications/${n.id}`);
                      setNotifications((prev) => prev.filter((item) => item.id !== n.id));
                    },
                  },
                ]
              : (() => {
                  const route = resolveNotificationRoute({
                    ...n,
                    metadata,
                    timestamp: new Date(n.timestamp),
                    isRead: Boolean(n.isRead),
                  } as Notification);
                  return route
                    ? [
                        {
                          label: route.label,
                          variant: 'primary' as const,
                          onClick: () => navigate(route.to, route.state ? { state: route.state } : undefined),
                        },
                      ]
                    : [];
                })(),
        };
      });
      setNotifications(mapped);
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }, [navigate, refreshUser, session?.token, setCurrentOrg]);

  useEffect(() => {
    fetchNotifications(true);
    const timer = window.setInterval(() => fetchNotifications(false), 20000);
    return () => window.clearInterval(timer);
  }, [fetchNotifications]);


  const filteredNotifications = useMemo(
    () =>
      filterType === 'all' ? notifications : notifications.filter((notification) => notification.type === filterType),
    [filterType, notifications],
  );

  const groupedNotifications = useMemo(() => {
    const urgent = filteredNotifications.filter((n) => n.priority === 'urgent');
    const today = filteredNotifications.filter((n) => n.priority === 'today');
    const recent = filteredNotifications.filter((n) => n.priority === 'recent');

    return { urgent, today, recent };
  }, [filteredNotifications]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const urgentCount = groupedNotifications.urgent.length;

  const handleMarkAllRead = async () => {
    const prev = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.post('/api/notifications/read-all');
    } catch {
      setNotifications(prev);
    }
  };

  const handleMarkRead = async (id: string) => {
    const prev = notifications;
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    try {
      await api.patch(`/api/notifications/${id}/read`);
    } catch {
      setNotifications(prev);
    }
  };

  const handleDismiss = async (id: string) => {
    const prev = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.delete(`/api/notifications/${id}`);
    } catch {
      setNotifications(prev);
    }
  };

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'meeting':
        return <FileText size={18} className="text-green-600 dark:text-green-400" />;
      case 'mention':
        return <MessageSquare size={18} className="text-purple-600 dark:text-purple-400" />;
      case 'user':
        return <UserPlus size={18} className="text-cyan-600 dark:text-cyan-400" />;
      case 'invitation':
        return <UserPlus size={18} className="text-primary-600 dark:text-primary-400" />;
      case 'system':
        return <Settings size={18} className="text-gray-600 dark:text-gray-400" />;
    }
  };

  const formatTime = (date: Date) => {
    const diffMs = Date.now() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Vừa xong';
    if (diffHours < 24) return `${diffHours} giờ trước`;
    if (diffDays === 1) return 'Hôm qua';
    return `${diffDays} ngày trước`;
  };

  const NotificationItem: React.FC<{ notification: Notification }> = ({ notification }) => (
    (() => {
      const normalizedTitle = (notification.title || '').toLowerCase();
      const normalizedMessage = (notification.message || '').toLowerCase();
      const isDeleteRequest =
        normalizedTitle.includes('yeu cau xoa') || normalizedMessage.includes('yeu cau xoa');
      const route = resolveNotificationRoute(notification);

      return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`group rounded-xl border p-4 transition hover:border-gray-300 dark:hover:border-slate-600 ${
        isDeleteRequest
          ? 'border-red-300 bg-red-500/10 dark:border-red-800/70 dark:bg-red-900/20'
          :
        notification.isRead
          ? 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'
          : 'border-primary-200 bg-primary-50/50 dark:border-primary-900/40 dark:bg-primary-900/10'
      }`}
      onClick={() => {
        void handleMarkRead(notification.id);
        if (route) {
          navigate(route.to, route.state ? { state: route.state } : undefined);
        }
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          {isDeleteRequest ? (
            <AlertCircle size={18} className="text-red-600 dark:text-red-400" />
          ) : (
            getNotificationIcon(notification.type)
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${
                isDeleteRequest
                  ? 'text-red-700 dark:text-red-300'
                  :
                notification.isRead 
                  ? 'text-gray-900 dark:text-slate-100' 
                  : 'text-primary-700 dark:text-primary-300'
              }`}>
                {notification.title}
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                {notification.message}
              </p>

              {/* Metadata */}
              {notification.metadata && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-slate-500">
                  {typeof notification.metadata.group === 'string' && notification.metadata.group && (
                    <span className="flex items-center gap-1"><FolderOpen size={10} /> {notification.metadata.group}</span>
                  )}
                  {typeof notification.metadata.organizationName === 'string' && notification.metadata.organizationName && (
                    <span>{notification.metadata.organizationName}</span>
                  )}
                  {notification.metadata.dueDate && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Hạn: {notification.metadata.dueDate}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Timestamp & Actions */}
            <div className="flex flex-col items-end gap-2">
              <span className="text-xs text-gray-400 dark:text-slate-500">
                {formatTime(notification.timestamp)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDismiss(notification.id);
                }}
                className="opacity-0 transition group-hover:opacity-100 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          {notification.actions && notification.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {notification.actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick?.();
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isDeleteRequest
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : action.variant === 'primary'
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
      );
    })()
  );

  const NotificationSection: React.FC<{
    title: string;
    icon: React.ReactNode;
    color: string;
    items: Notification[];
  }> = ({ title, icon, color, items }) => {
    if (items.length === 0) return null;

    return (
      <div>
        <h3 className={`mb-3 flex items-center gap-2 text-base font-bold ${color}`}>
          {icon}
          {title} ({items.length})
        </h3>
        <div className="space-y-3">
          <AnimatePresence>
            {items.map((item) => (
              <NotificationItem key={item.id} notification={item} />
            ))}
          </AnimatePresence>
        </div>
      </div>
    );
  };

  if (loading) return <PageState title="Đang tải thông báo" description="Hệ thống đang đồng bộ các thông báo mới nhất cho bạn." tone="loading" compact />;

  if (error) {
    return (
      <PageState
        title="Không tải được thông báo"
        description={error}
        tone="error"
        compact
        action={(
          <button
            onClick={() => void fetchNotifications(true)}
            className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700"
          >
            Tải lại
          </button>
        )}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
            Thông báo
          </h1>
          <p className="mt-1 text-gray-600 dark:text-slate-400">
            {unreadCount > 0
              ? `Bạn có ${unreadCount} thông báo chưa đọc`
              : 'Bạn đã xem hết thông báo!'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCheck size={14} />
            Đánh dấu tất cả đã đọc
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
          >
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-slate-100">
            Notification Preferences
          </h3>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                  Tóm tắt cuộc họp
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Thông báo khi AI tóm tắt xong cuộc họp
                </p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded text-primary-600" />
            </label>
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                  Cuộc họp mới
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Thông báo khi có cuộc họp mới trong nhóm
                </p>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded text-primary-600" />
            </label>
          </div>
        </motion.div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all', label: 'Tất cả', count: notifications.length },
          { key: 'meeting', label: 'Cuộc họp', count: notifications.filter((n) => n.type === 'meeting').length },
          { key: 'invitation', label: 'Lời mời', count: notifications.filter((n) => n.type === 'invitation').length },
          { key: 'mention', label: 'Nhắc đến', count: notifications.filter((n) => n.type === 'mention').length },
          { key: 'system', label: 'Hệ thống', count: notifications.filter((n) => n.type === 'system').length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterType(tab.key as NotificationFilter)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              filterType === tab.key
                ? 'bg-primary-600 text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                filterType === tab.key
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        {filterType === 'all'
          ? 'Tập trung vào thông báo chưa đọc và bấm trực tiếp để mở đúng ngữ cảnh cần xử lý.'
          : `Đang lọc theo loại ${filterType}. Các thẻ thông báo có thể mở thẳng meeting, nhóm hoặc việc liên quan.`}
      </div>

      {/* Thông báo List */}
      <div className="space-y-6">
        <NotificationSection
          title="URGENT"
          icon={<AlertCircle size={16} />}
          color="text-red-600 dark:text-red-400"
          items={groupedNotifications.urgent}
        />

        <NotificationSection
          title="DUE TODAY"
          icon={<Clock size={16} />}
          color="text-amber-600 dark:text-amber-400"
          items={groupedNotifications.today}
        />

        <NotificationSection
          title="RECENT"
          icon={<Bell size={16} />}
          color="text-gray-600 dark:text-gray-400"
          items={groupedNotifications.recent}
        />

        {filteredNotifications.length === 0 && (
          <PageState
            title={notifications.length === 0 ? 'Không có thông báo' : 'Không có thông báo phù hợp bộ lọc'}
            description={
              notifications.length === 0
                ? 'Bạn đã xem hết thông báo. Khi có cuộc họp, lời mời, việc cần làm hoặc cập nhật hệ thống mới, chúng sẽ xuất hiện ở đây.'
                : 'Hãy đổi bộ lọc để xem thêm thông báo ở ngữ cảnh khác.'
            }
            tone="empty"
            compact
          />
        )}
      </div>
    </div>
  );
};

export default Notifications;
