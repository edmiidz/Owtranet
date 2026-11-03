import React from 'react';
import { FileText, ExternalLink, Mail, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

const PendingAgreementPage: React.FC = () => {
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white shadow-lg rounded-lg p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
            <FileText className="h-8 w-8 text-blue-600" />
          </div>

          {/* Header */}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Agreement Required</h1>
          <p className="text-gray-600 mb-6">
            Welcome {user?.name}! To access The Intranet, you need to sign our team member agreement.
          </p>

          {/* Email Status */}
          {user?.email_verified ? (
            <div className="flex items-center justify-center mb-6 text-green-600">
              <CheckCircle className="h-4 w-4 mr-2" />
              <span className="text-sm">Email verified: {user.email}</span>
            </div>
          ) : (
            <div className="flex items-center justify-center mb-6 text-orange-600">
              <Mail className="h-4 w-4 mr-2" />
              <span className="text-sm">Please verify your email first: {user?.email}</span>
            </div>
          )}

          {/* Agreement Action */}
          <div className="space-y-4">
            <a
              href="/agreement"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <FileText className="h-4 w-4 mr-2" />
              Sign Team Agreement
              <ExternalLink className="h-4 w-4 ml-2" />
            </a>
            
            <p className="text-xs text-gray-500">
              Opens in a new tab to avoid display issues
            </p>
          </div>

          {/* Additional Info */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="font-medium text-gray-900 mb-2">What's Required:</h3>
            <ul className="text-sm text-gray-600 text-left space-y-1">
              <li>• Read the team member agreement</li>
              <li>• Answer a simple quiz question</li>
              <li>• Type "Agree" to sign digitally</li>
              <li>• Check all confirmation boxes</li>
            </ul>
          </div>

          {/* Logout Option */}
          <div className="mt-6">
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-gray-700 text-sm"
            >
              Sign out and use different account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PendingAgreementPage;