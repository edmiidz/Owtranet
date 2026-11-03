import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { usesSelfHostedMail } from '../utils/emailProvider';
import { emailRequestsApi } from '../utils/api';
import type { EmailRequest } from '../types';

const emailRequestSchema = z.object({
  email_prefix: z
    .string()
    .min(1, 'Email prefix is required')
    .max(50, 'Email prefix cannot exceed 50 characters')
    .refine((val) => {
      const domain = useBrandingStore.getState().companyEmailDomain;
      if (val.includes('@')) {
        return new RegExp(`^[a-zA-Z0-9._-]+@${domain.replace('.', '\\.')}$`).test(val);
      }
      return /^[a-zA-Z0-9._-]+$/.test(val);
    }, `Enter username or full email address`),
  justification: z
    .string()
    .optional()
    .default(''),
});

type EmailRequestFormData = z.infer<typeof emailRequestSchema>;

const EmailRequestPage: React.FC = () => {
  const { user } = useAuthStore();
  const { companyName, companyEmailDomain, defaultEmailProvider } = useBrandingStore();
  const selfHostedMail = usesSelfHostedMail(user, defaultEmailProvider);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [myRequests, setMyRequests] = useState<EmailRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmailRequestFormData>({
    resolver: zodResolver(emailRequestSchema),
  });

  // Load email requests (all for admins, own for users)
  useEffect(() => {
    const loadMyRequests = async () => {
      try {
        // Backend already filters based on user role - no need to filter here
        const requests = await emailRequestsApi.getEmailRequests();
        setMyRequests(requests);
      } catch (error) {
        console.error('Failed to load requests:', error);
      } finally {
        setLoadingRequests(false);
      }
    };

    if (user?.role === 'admin') {
      loadMyRequests();
    } else {
      setLoadingRequests(false);
    }
  }, [user]);

  const onSubmit = async (data: EmailRequestFormData) => {
    try {
      setError('');
      setSuccess('');
      setIsLoading(true);

      // Normalize email: trim, lowercase, and append company domain if not present
      const normalizedPrefix = data.email_prefix.trim().toLowerCase();
      const requested_email = normalizedPrefix.includes('@')
        ? normalizedPrefix
        : `${normalizedPrefix}@${companyEmailDomain}`;

      const requestData = {
        requested_email,
        justification: data.justification || ''
      };

      await emailRequestsApi.createEmailRequest(requestData);
      
      setSuccess('Email request submitted successfully! Admins have been notified and will review your request.');
      reset();
      
      // Reload requests if admin
      if (user?.role === 'admin') {
        const requests = await emailRequestsApi.getEmailRequests();
        setMyRequests(requests.filter(r => r.user_id === user?.id));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit email request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'text-green-700 bg-green-50 border-green-200';
      case 'rejected':
        return 'text-red-700 bg-red-50 border-red-200';
      default:
        return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <Mail className="h-12 w-12 text-primary-600 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-gray-900">Request @{companyEmailDomain} Email</h1>
        <p className="mt-2 text-lg text-gray-600">
          Request your official {companyName} email address for external communications
        </p>
      </div>

      {/* External provider: a company mailbox is only provisioned for the self-hosted option */}
      {!selfHostedMail && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-yellow-800">
          <div className="flex items-start">
            <AlertCircle className="h-6 w-6 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
            <p>
              Your <strong>Email &amp; Calendar Provider</strong> is set to an external service, so no @{companyEmailDomain} mailbox
              is hosted here. To request one, switch the provider to the self-hosted option on your profile first.
            </p>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start">
          <AlertCircle className="h-6 w-6 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-blue-900 mb-2">Email Request Process</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Submit a request with a valid @{companyEmailDomain} email address</li>
              <li>• Provide detailed justification for why you need this email</li>
              <li>• Admin review and approval required</li>
              <li>• You'll receive email confirmation once processed</li>
              <li>• Contact system administrator for email setup after approval</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Request Form */}
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Submit New Request</h2>
          
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                {success}
              </div>
            )}

            <div>
              <label htmlFor="email_prefix" className="block text-sm font-medium text-gray-700 mb-1">
                Requested Email Address *
              </label>
              <input
                {...register('email_prefix')}
                type="text"
                className="form-input"
                placeholder={`yourname or yourname@${companyEmailDomain}`}
              />
              {errors.email_prefix && (
                <p className="mt-1 text-sm text-red-600">{errors.email_prefix.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Choose a professional username (e.g., firstname.lastname, role.department)
              </p>
            </div>

            <div>
              <label htmlFor="justification" className="block text-sm font-medium text-gray-700 mb-1">
                Justification (Optional)
              </label>
              <textarea
                {...register('justification')}
                rows={6}
                className="form-input"
                placeholder="Optionally explain why you need this email address..."
              />
              {errors.justification && (
                <p className="mt-1 text-sm text-red-600">{errors.justification.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Provide detailed justification to help admins approve your request
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn btn-primary"
            >
              {isLoading ? 'Submitting Request...' : 'Submit Email Request'}
            </button>
          </form>
        </div>

        {/* Email Requests */}
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            {user?.role === 'admin' ? 'All Email Requests' : 'My Requests'}
          </h2>
          
          {loadingRequests ? (
            <div className="text-center text-gray-500">
              {user?.role === 'admin' ? 'Loading all requests...' : 'Loading your requests...'}
            </div>
          ) : myRequests.length > 0 ? (
            <div className="space-y-4">
              {myRequests.map((request) => (
                <div key={request.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        {getStatusIcon(request.status)}
                        <span className="ml-2 font-medium text-gray-900">
                          {request.requested_email}
                        </span>
                        {user?.role === 'admin' && (
                          <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                            by {request.requester_name}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {request.justification}
                      </p>
                      <div className="text-xs text-gray-500">
                        Submitted {new Date(request.created_at).toLocaleDateString()}
                        {request.approved_at && (
                          <span> • Processed {new Date(request.approved_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(request.status)}`}>
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </div>
                  
                  {request.rejection_reason && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-700">
                        <strong>Rejection Reason:</strong> {request.rejection_reason}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500">
              <Mail className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No email requests yet</p>
              <p className="text-sm">Submit your first request using the form</p>
            </div>
          )}
        </div>
      </div>

      {/* Guidelines */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Request Guidelines</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-2">✅ Good Examples:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• firstname.lastname@{companyEmailDomain}</li>
              <li>• role.department@{companyEmailDomain} (e.g., support.tech@{companyEmailDomain})</li>
              <li>• team.function@{companyEmailDomain} (e.g., sales.team@{companyEmailDomain})</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-2">❌ Avoid:</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Personal nicknames or casual terms</li>
              <li>• Numbers without context (user123@{companyEmailDomain})</li>
              <li>• Generic terms (info@, admin@, test@)</li>
              <li>• Emails that don't reflect your role/purpose</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailRequestPage;