import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useBrandingStore } from './stores/brandingStore';
import { usesSelfHostedMail } from './utils/emailProvider';

// Import components (we'll create these)
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ForumPage from './pages/ForumPage';
import PostPage from './pages/PostPage';
import CreatePostPage from './pages/CreatePostPage';
import TasksPage from './pages/TasksPage';
import TaskDetailPage from './pages/TaskDetailPage';
import CreateTaskPage from './pages/CreateTaskPage';
import EditTaskPage from './pages/EditTaskPage';
import InvestmentTrackerPage from './pages/InvestmentTrackerPage';
import DeliverableDetailPage from './pages/DeliverableDetailPage';
import PaymentManagementPage from './pages/PaymentManagementPage';
import EmailRequestPage from './pages/EmailRequestPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import SearchPage from './pages/SearchPage';
import GithubDocPage from './pages/GithubDocPage';
import MessagesPage from './pages/MessagesPage';
import GroupChatPage from './pages/GroupChatPage';
import EditPostPage from './pages/EditPostPage';
import PostTtsPage from './pages/PostTtsPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AgreementPage from './pages/AgreementPage';
import PendingAgreementPage from './pages/PendingAgreementPage';
import EmailVerificationPage from './pages/EmailVerificationPage';
import AgreementDetailsPage from './pages/AgreementDetailsPage';
import TestPage from './pages/TestPage';
import WebmailPage from './pages/WebmailPage';
import LogoutPage from './pages/LogoutPage';
import LedgerPage from './pages/LedgerPage';
import LedgerDetailPage from './pages/LedgerDetailPage';

// Protected Route Component
interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'moderator';
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { isAuthenticated, user, token } = useAuthStore();

  // IMPORTANT: Check for CRM return FIRST before any other redirects
  const params = new URLSearchParams(window.location.search);
  const crmReturn = params.get('crm_return');

  if (crmReturn && isAuthenticated && token) {
    // Redirect back to CRM with token immediately
    const returnUrl = decodeURIComponent(crmReturn);
    const separator = returnUrl.includes('?') ? '&' : '?';
    window.location.href = `${returnUrl}${separator}token=${token}`;
    return null; // Don't render anything while redirecting
  }

  if (!isAuthenticated) {
    // Store the current location for redirect after login
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    localStorage.setItem('owtranet-redirect-after-login', currentPath);
    return <Navigate to="/login" replace />;
  }

  // Handle users who need to sign agreement - render pending page directly instead of navigation
  // Allow access only to agreement page and logout functionality
  const currentPath = window.location.pathname;
  const allowedPaths = ['/agreement', '/test'];
  const isAllowedPath = allowedPaths.some(path => currentPath.startsWith(path));

  if (user?.role === 'pending_agreement' && !isAllowedPath) {
    // Instead of showing inline message, redirect to agreement page
    return <Navigate to="/agreement" replace />;
  }

  if (requiredRole && user?.role !== requiredRole && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// Webmail Route Protection (requires company_email)
interface WebmailRouteProps {
  children: React.ReactNode;
}

const WebmailRoute: React.FC<WebmailRouteProps> = ({ children }) => {
  const { isAuthenticated, user } = useAuthStore();
  const { defaultEmailProvider } = useBrandingStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Webmail is only for the self-hosted provider; external-provider members go to their own client
  if (!usesSelfHostedMail(user, defaultEmailProvider)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!user?.company_email) {
    return <Navigate to="/email-request" replace />;
  }

  return <>{children}</>;
};

// Public Route Component (redirect to dashboard if authenticated)
interface PublicRouteProps {
  children: React.ReactNode;
  allowAuthenticated?: boolean;
}

const PublicRoute: React.FC<PublicRouteProps> = ({ children, allowAuthenticated = false }) => {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated && !allowAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};


function App() {
  // Fetch branding config on mount and update page title
  React.useEffect(() => {
    useBrandingStore.getState().fetchBranding().then(() => {
      const name = useBrandingStore.getState().companyName;
      document.title = `${name} Intranet - Internal Collaboration`;
    });
  }, []);

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={
            <PublicRoute allowAuthenticated={true}>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={<RegisterPage />}
        />
        <Route
          path="/verify-email"
          element={<EmailVerificationPage />}
        />
        <Route
          path="/forgot-password"
          element={<ForgotPasswordPage />}
        />
        <Route
          path="/reset-password"
          element={<ResetPasswordPage />}
        />
        <Route
          path="/logout"
          element={<LogoutPage />}
        />

        {/* Agreement Routes - Must be accessible for pending_agreement users */}
        <Route path="/agreement" element={<AgreementPage />} />
        {/* Per-user assigned agreements (employment/custom) - no lockout, but must be logged in */}
        <Route
          path="/agreements/:assignmentId"
          element={
            <ProtectedRoute>
              <AgreementPage />
            </ProtectedRoute>
          }
        />
        <Route path="/test" element={<TestPage />} />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="forum" element={<ForumPage />} />
          <Route path="forum/post/:slug" element={<PostPage />} />
          <Route path="forum/post/:slug/tts" element={<PostTtsPage />} />
          <Route path="forum/create" element={<CreatePostPage />} />
          <Route path="forum/edit/:slug" element={<EditPostPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/create" element={<CreateTaskPage />} />
          <Route path="tasks/edit/:id" element={<EditTaskPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="investment-tracker" element={<InvestmentTrackerPage />} />
          <Route path="investment-tracker/payments" element={<PaymentManagementPage />} />
          <Route path="investment-tracker/:id" element={<DeliverableDetailPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="ledger/:id" element={<LedgerDetailPage />} />
          <Route path="email-request" element={<EmailRequestPage />} />
          <Route path="profile/:username" element={<ProfilePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="docs/:id" element={<GithubDocPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="group-chat" element={<GroupChatPage />} />
          <Route path="group-chat/:groupName" element={<GroupChatPage />} />
          <Route path="pending-agreement" element={<PendingAgreementPage />} />
          
          {/* Admin Routes */}
          <Route
            path="webmail"
            element={
              <WebmailRoute>
                <WebmailPage />
              </WebmailRoute>
            }
          />
          <Route
            path="admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/agreement/:agreementId"
            element={
              <ProtectedRoute requiredRole="admin">
                <AgreementDetailsPage />
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;