import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const LogoutPage: React.FC = () => {
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('[LOGOUT PAGE] Forcing logout and clearing all data');
    
    // Clear all auth-related localStorage
    localStorage.removeItem('owtranet-token');
    localStorage.removeItem('owtranet-user');
    localStorage.removeItem('owtranet-cache-version');
    localStorage.removeItem('owtranet-redirect-after-login');
    
    // Call logout to clear zustand state
    logout();
    
    console.log('[LOGOUT PAGE] All auth data cleared, redirecting to login');
    
    // Redirect to login after a short delay
    setTimeout(() => {
      navigate('/login', { replace: true });
    }, 500);
  }, [logout, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Logging out...</p>
      </div>
    </div>
  );
};

export default LogoutPage;
