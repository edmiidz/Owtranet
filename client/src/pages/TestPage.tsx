import React from 'react';
import { useAuthStore } from '../stores/authStore';

const TestPage: React.FC = () => {
  const { user } = useAuthStore();
  
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center p-8 bg-white rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Test Page</h1>
        <p className="text-gray-600 mb-2">This is a simple test page to verify routing works.</p>
        <div className="text-sm text-gray-500">
          <p>User: {user?.name || 'Not logged in'}</p>
          <p>Role: {user?.role || 'None'}</p>
          <p>Email: {user?.email || 'None'}</p>
          <p>Timestamp: {new Date().toISOString()}</p>
        </div>
        <div className="mt-4">
          <a href="/dashboard" className="text-blue-600 hover:text-blue-800">Go to Dashboard</a>
          {' | '}
          <a href="/agreement" className="text-blue-600 hover:text-blue-800">Go to Agreement</a>
        </div>
      </div>
    </div>
  );
};

export default TestPage;