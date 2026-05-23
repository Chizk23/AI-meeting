import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { usePermission } from './hooks/usePermission';
import { useUIStore } from './stores';
import Layout from './layouts/Layout';
import AdminLayout from './layouts/AdminLayout';

import Landing from './pages/Landing';
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/Register'));
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'));
const Invite = React.lazy(() => import('./pages/Invite'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const MeetingList = React.lazy(() => import('./pages/MeetingList'));
const MeetingDetail = React.lazy(() => import('./pages/MeetingDetail'));
const Calendar = React.lazy(() => import('./pages/meeting/Calendar'));
const CreateMeeting = React.lazy(() => import('./pages/CreateMeeting'));
const MeetingRoom = React.lazy(() => import('./pages/MeetingRoom'));
const JoinMeeting = React.lazy(() => import('./pages/JoinMeeting'));
const UploadAudio = React.lazy(() => import('./pages/meeting/UploadAudio'));
const Notifications = React.lazy(() => import('./pages/Notifications'));
const ActionItems = React.lazy(() => import('./pages/ActionItems'));
const NotFound = React.lazy(() => import('./pages/NotFound'));
const Forbidden = React.lazy(() => import('./pages/Forbidden'));
const GroupDetail = React.lazy(() => import('./pages/group/GroupDetail'));
const CreateGroup = React.lazy(() => import('./pages/group/CreateGroup'));
const OrgAdminConsole = React.lazy(() => import('./pages/org/OrgAdminConsole'));
const SystemAdminConsole = React.lazy(() => import('./pages/admin/SystemAdminConsole'));
const AdminOrganizations = React.lazy(
  () => import('./pages/admin/components/AdminOrganizations'),
);
const AdminUsers = React.lazy(() => import('./pages/admin/components/AdminUsers'));
const AdminAIServices = React.lazy(() => import('./pages/admin/components/AdminAIServices'));
const AdminPrompts = React.lazy(() => import('./pages/admin/components/AdminPrompts'));
const AdminNotifications = React.lazy(() => import('./pages/admin/components/AdminNotifications'));
const AdminAuditLogs = React.lazy(() => import('./pages/admin/components/AdminAuditLogs'));
const AdminSettings = React.lazy(() => import('./pages/admin/components/AdminSettings'));
const OrganizationSetup = React.lazy(() => import('./pages/OrganizationSetup'));
const Profile = React.lazy(() => import('./pages/profile/Profile'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

const hasApprovedOrganizations = (user: ReturnType<typeof useAuth>['user']) =>
  Boolean(user?.orgMemberships?.some((membership) => membership.approvalStatus !== 'pending'));

const PageLoader: React.FC = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
  </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isAuthReady } = useAuth();
  if (!isAuthReady) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const ApprovedOrganizationRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthReady } = useAuth();
  const { isSystemAdmin } = usePermission();

  if (!isAuthReady) return <PageLoader />;

  if (!hasApprovedOrganizations(user)) {
    return <Navigate to={isSystemAdmin ? '/admin/console' : '/setup-organization'} replace />;
  }

  return <>{children}</>;
};

const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isAuthReady, user } = useAuth();
  const { isSystemAdmin } = usePermission();

  if (!isAuthReady) return <PageLoader />;

  if (isAuthenticated) {
    return (
      <Navigate
        to={
          isSystemAdmin
            ? '/admin/console'
            : hasApprovedOrganizations(user)
              ? '/dashboard'
              : '/setup-organization'
        }
        replace
      />
    );
  }

  return <>{children}</>;
};

const RoleGuard: React.FC<{ children: React.ReactNode; roles: string[] }> = ({
  children,
  roles,
}) => {
  const { isSystemAdmin, isOrgAdmin, isGroupAdmin, isViewer, isMember } = usePermission();

  const hasAccess =
    (roles.includes('system-admin') && isSystemAdmin) ||
    (roles.includes('org-admin') && isOrgAdmin) ||
    (roles.includes('group-admin') && (isGroupAdmin || isOrgAdmin)) ||
    (roles.includes('member') && (isMember || isGroupAdmin || isOrgAdmin)) ||
    (roles.includes('viewer') && (isViewer || isMember || isGroupAdmin || isOrgAdmin));

  if (!hasAccess) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold text-red-500">Khong co quyen truy cap</h1>
        <p className="text-gray-600">Ban khong co quyen xem trang nay.</p>
      </div>
    );
  }

  return <>{children}</>;
};

const AppRoutes: React.FC = () => {
  const { isAuthenticated, isAuthReady, user } = useAuth();
  const { isSystemAdmin } = usePermission();

  if (!isAuthReady) {
    return <PageLoader />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate
              to={
                isSystemAdmin
                  ? '/admin/console'
                  : hasApprovedOrganizations(user)
                    ? '/dashboard'
                    : '/setup-organization'
              }
              replace
            />
          ) : (
            <Landing />
          )
        }
      />
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <React.Suspense fallback={<PageLoader />}>
              <Login />
            </React.Suspense>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicOnlyRoute>
            <React.Suspense fallback={<PageLoader />}>
              <Register />
            </React.Suspense>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnlyRoute>
            <React.Suspense fallback={<PageLoader />}>
              <ForgotPassword />
            </React.Suspense>
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/join/:code?"
        element={
          <React.Suspense fallback={<PageLoader />}>
            <JoinMeeting />
          </React.Suspense>
        }
      />
      <Route
        path="/invite"
        element={
          <React.Suspense fallback={<PageLoader />}>
            <Invite />
          </React.Suspense>
        }
      />
      <Route
        path="/room/:code"
        element={
          <React.Suspense fallback={<PageLoader />}>
            <MeetingRoom />
          </React.Suspense>
        }
      />
      <Route
        path="/setup-organization"
        element={
          <ProtectedRoute>
            <React.Suspense fallback={<PageLoader />}>
              <OrganizationSetup />
            </React.Suspense>
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <ApprovedOrganizationRoute>
              <Layout />
            </ApprovedOrganizationRoute>
          </ProtectedRoute>
        }
      >
        <Route
          path="/dashboard"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <Dashboard />
            </React.Suspense>
          }
        />
        <Route
          path="/meetings"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <MeetingList />
            </React.Suspense>
          }
        />
        <Route
          path="/calendar"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <Calendar />
            </React.Suspense>
          }
        />
        <Route
          path="/meetings/:id"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <MeetingDetail />
            </React.Suspense>
          }
        />
        <Route
          path="/meetings/create"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <CreateMeeting />
            </React.Suspense>
          }
        />
        <Route
          path="/upload"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <UploadAudio />
            </React.Suspense>
          }
        />
        <Route
          path="/actions"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <ActionItems />
            </React.Suspense>
          }
        />
        <Route
          path="/notifications"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <Notifications />
            </React.Suspense>
          }
        />
        <Route
          path="/groups/create"
          element={
            <RoleGuard roles={['org-admin']}>
              <React.Suspense fallback={<PageLoader />}>
                <CreateGroup />
              </React.Suspense>
            </RoleGuard>
          }
        />
        <Route
          path="/groups/:id"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <GroupDetail />
            </React.Suspense>
          }
        />
        <Route
          path="/org/admin"
          element={
            <RoleGuard roles={['org-admin', 'system-admin']}>
              <React.Suspense fallback={<PageLoader />}>
                <OrgAdminConsole />
              </React.Suspense>
            </RoleGuard>
          }
        />
        <Route
          path="/org/admin/:tab"
          element={
            <RoleGuard roles={['org-admin', 'system-admin']}>
              <React.Suspense fallback={<PageLoader />}>
                <OrgAdminConsole />
              </React.Suspense>
            </RoleGuard>
          }
        />
        <Route
          path="/profile"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <Profile />
            </React.Suspense>
          }
        />
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <RoleGuard roles={['system-admin']}>
              <AdminLayout />
            </RoleGuard>
          </ProtectedRoute>
        }
      >
        <Route
          path="console"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <SystemAdminConsole />
            </React.Suspense>
          }
        />
        <Route
          path="organizations"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminOrganizations />
            </React.Suspense>
          }
        />
        <Route
          path="users"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminUsers />
            </React.Suspense>
          }
        />
        <Route
          path="ai-services"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminAIServices />
            </React.Suspense>
          }
        />
        <Route
          path="prompts"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminPrompts />
            </React.Suspense>
          }
        />
        <Route
          path="notifications"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminNotifications />
            </React.Suspense>
          }
        />
        <Route
          path="audit-logs"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminAuditLogs />
            </React.Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <React.Suspense fallback={<PageLoader />}>
              <AdminSettings />
            </React.Suspense>
          }
        />
      </Route>

      <Route
        path="/403"
        element={
          <React.Suspense fallback={<PageLoader />}>
            <Forbidden />
          </React.Suspense>
        }
      />
      <Route
        path="/404"
        element={
          <React.Suspense fallback={<PageLoader />}>
            <NotFound />
          </React.Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App: React.FC = () => {
  const { isDarkMode } = useUIStore();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster
            position="top-right"
            toastOptions={{ style: { background: '#363636', color: '#fff' } }}
          />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
