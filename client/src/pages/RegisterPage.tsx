import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';

const registerSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .refine((email) => {
      const domain = useBrandingStore.getState().companyEmailDomain;
      return !domain || !email.endsWith(`@${domain}`);
    }, 'Cannot use a company email address for registration. Please use a personal email like Gmail, Yahoo, etc.'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  name: z.string().min(1, 'Name is required'),
  github_username: z.string().optional(),
  company: z.string().optional(),
  telephone: z.string().optional(),
  invite_code: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type RegisterFormData = z.infer<typeof registerSchema>;

const RegisterPage: React.FC = () => {
  const { companyName } = useBrandingStore();
  const [searchParams] = useSearchParams();
  const inviteCode = searchParams.get('invite');
  const inviteLink = searchParams.get('link');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [inviteValid, setInviteValid] = useState(false);
  const [inviteData, setInviteData] = useState<any>(null);
  const [isInviteLink, setIsInviteLink] = useState(false);
  const navigate = useNavigate();
  const { logout, isAuthenticated } = useAuthStore();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  // Force logout if user is authenticated when accessing registration with invite
  useEffect(() => {
    if ((inviteCode || inviteLink) && isAuthenticated) {
      console.log('Force logout: User accessing registration while authenticated');
      logout();
    }
  }, [inviteCode, inviteLink, isAuthenticated, logout]);

  // Validate invite code or link on mount
  useEffect(() => {
    if (!inviteCode && !inviteLink) {
      setError('Invalid or missing invitation. Registration requires an invitation code or link.');
      return;
    }

    const validateInvite = async () => {
      try {
        let response;
        let isLink = false;
        
        if (inviteLink) {
          response = await fetch(`/api/invite-links/${inviteLink}/validate`);
          isLink = true;
        } else if (inviteCode) {
          response = await fetch(`/api/invites/${inviteCode}/validate`);
          isLink = false;
        }
        
        if (response && response.ok) {
          const data = await response.json();
          setInviteValid(true);
          setInviteData(data);
          setIsInviteLink(isLink);
          
          // Pre-fill form if invite has specific email/name (only for invite codes)
          if (!isLink && data.email) setValue('email', data.email);
          if (!isLink && data.name) setValue('name', data.name);
          if (inviteCode) setValue('invite_code', inviteCode);
        } else {
          const errorData = await response?.json();
          setError(errorData?.error || 'Invalid invitation');
        }
      } catch (err) {
        setError('Failed to validate invitation');
      }
    };

    validateInvite();
  }, [inviteCode, inviteLink, setValue]);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      setError('');
      setSuccess('');
      setIsLoading(true);
      
      const { confirmPassword, ...registerData } = data;
      
      // Add invite_link if using an invite link
      const finalData = {
        ...registerData,
        ...(inviteLink ? { invite_link: inviteLink } : {})
      };
      
      await authApi.register(finalData);
      
      setSuccess('Registration successful! Your account is now active. Redirecting to login...');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render form if invite is invalid
  if (!inviteValid && (inviteCode || inviteLink)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h2 className="text-3xl font-extrabold text-gray-900">
              Invalid Invitation
            </h2>
            <p className="mt-4 text-gray-600">
              This invitation link is invalid, expired, or has already been used.
            </p>
            <Link to="/login" className="btn btn-primary mt-6 inline-flex">
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!inviteCode && !inviteLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h2 className="text-3xl font-extrabold text-gray-900">
              Invitation Required
            </h2>
            <p className="mt-4 text-gray-600">
              Registration is by invitation only. Please contact an admin to request access.
            </p>
            <Link to="/login" className="btn btn-primary mt-6 inline-flex">
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Complete Your Registration
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {isInviteLink ? `Join ${inviteData?.name || `${companyName} Intranet`}` : `You've been invited to join ${companyName} Intranet`}
          </p>
          {inviteData?.description && isInviteLink && (
            <p className="mt-1 text-center text-sm text-blue-600">
              {inviteData.description}
            </p>
          )}
          {inviteData?.email && !isInviteLink && (
            <p className="mt-1 text-center text-sm text-green-600">
              Invited as: {inviteData.email}
            </p>
          )}
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          {/* Hidden invite code field */}
          <input {...register('invite_code')} type="hidden" value={inviteCode || ''} />
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

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Full Name *
              </label>
              <input
                {...register('name')}
                type="text"
                className="mt-1 form-input"
                placeholder="Enter your full name"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address *
              </label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                className="mt-1 form-input"
                placeholder="Enter your email"
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="github_username" className="block text-sm font-medium text-gray-700">
                GitHub Username (Optional)
              </label>
              <input
                {...register('github_username')}
                type="text"
                className="mt-1 form-input"
                placeholder="Your GitHub username (optional)"
              />
              {errors.github_username && (
                <p className="mt-1 text-sm text-red-600">{errors.github_username.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                {`Company (other than ${companyName})`}
              </label>
              <input
                {...register('company')}
                type="text"
                className="mt-1 form-input"
                placeholder="Your company (optional)"
              />
            </div>

            <div>
              <label htmlFor="telephone" className="block text-sm font-medium text-gray-700">
                Phone Number
              </label>
              <input
                {...register('telephone')}
                type="tel"
                className="mt-1 form-input"
                placeholder="Your phone number (optional)"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password *
              </label>
              <input
                {...register('password')}
                type="password"
                autoComplete="new-password"
                className="mt-1 form-input"
                placeholder="Choose a password (min 6 characters)"
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm Password *
              </label>
              <input
                {...register('confirmPassword')}
                type="password"
                autoComplete="new-password"
                className="mt-1 form-input"
                placeholder="Confirm your password"
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Creating account...' : 'Create account'}
            </button>
          </div>

          <div className="text-center">
            <Link
              to="/login"
              className="font-medium text-primary-600 hover:text-primary-500"
            >
              Already have an account? Sign in
            </Link>
          </div>

          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700">
              <strong>Invitation Valid!</strong> Complete the form below to create your account.
              {inviteData?.expires_at && (
                <span> Expires: {new Date(inviteData.expires_at).toLocaleDateString()}</span>
              )}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;