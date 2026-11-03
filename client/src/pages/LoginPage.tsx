import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Lock, Key, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { authApi } from '../utils/api';

const loginSchema = z.object({
  email: z.string().min(1, 'Email or username is required'),
  password: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

const LoginPage: React.FC = () => {
  const { companyName } = useBrandingStore();
  const [error, setError] = useState<string>('');
  const [authMethod, setAuthMethod] = useState<'password' | 'email'>('password');
  const [emailSent, setEmailSent] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [emailForAuth, setEmailForAuth] = useState('');
  const [countdown, setCountdown] = useState(0);
  const { login, setLoading, isLoading, isAuthenticated, user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requireAgreement = searchParams.get('require_agreement');
  const tokenFromUrl = searchParams.get('token');

  // Check for token in URL and auto-login
  useEffect(() => {
    if (tokenFromUrl && !isAuthenticated) {
      handleTokenLogin(tokenFromUrl);
    }
  }, [tokenFromUrl]);

  // If user is already authenticated and force-agreement is requested, show special message or redirect
  useEffect(() => {
    if (isAuthenticated && requireAgreement) {
      if (user?.role === 'pending_agreement') {
        navigate('/agreement');
      } else {
        navigate('/agreement');
      }
    }
  }, [isAuthenticated, requireAgreement, user?.role, navigate]);

  // Countdown timer for email expiration
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Show different content if user is authenticated and on force-agreement flow
  if (isAuthenticated && requireAgreement) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="bg-white shadow-lg rounded-lg p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
              <span className="text-2xl">📄</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Agreement Required</h1>
            <p className="text-gray-600 mb-6">
              Hi {user?.name}! Please sign the required team agreement to continue using the platform.
            </p>
            <a
              href="/agreement"
              className="w-full inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors mb-4"
            >
              Sign Team Agreement
            </a>
          </div>
        </div>
      </div>
    );
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const handleTokenLogin = async (token: string) => {
    try {
      setLoading(true);
      const response = await authApi.verifyEmailToken({ token });
      login(response.token, response.user);

      const redirectPath = localStorage.getItem('owtranet-redirect-after-login');
      if (redirectPath) {
        localStorage.removeItem('owtranet-redirect-after-login');
        window.location.replace(redirectPath);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError('Invalid or expired login link. Please request a new one.');
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('token');
      window.history.replaceState({}, '', newUrl.toString());
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (email: string) => {
    try {
      setError('');
      setLoading(true);
      setEmailForAuth(email);

      const response = await authApi.requestEmailLogin(email);
      setEmailSent(true);
      setShowOtpInput(response.showOtp);
      setCountdown(response.expiresIn * 60);
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = errorData?.error || 'Failed to send login email. Please try again.';

      // Use the detailed message if available (for user not found)
      if (errorData?.message) {
        errorMessage = errorData.message;
      }

      console.error('Email auth failed:', {
        email: email,
        error: errorMessage,
        fullError: errorData,
        status: err.response?.status,
        userNotFound: errorData?.userNotFound
      });

      setError(errorMessage);
      // Keep error visible for at least 10 seconds
      setTimeout(() => {
        // Don't clear if a different error has been set
        setError(current => current === errorMessage ? '' : current);
      }, 10000);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerification = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    try {
      setError('');
      setLoading(true);

      const response = await authApi.verifyEmailToken({ otp: otpCode });
      login(response.token, response.user);

      const redirectPath = localStorage.getItem('owtranet-redirect-after-login');
      if (redirectPath) {
        localStorage.removeItem('owtranet-redirect-after-login');
        window.location.replace(redirectPath);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid or expired code. Please try again.');
      setOtpCode('');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    if (authMethod === 'email') {
      await handleEmailAuth(data.email);
    } else {
      if (!data.password) {
        setError('Password is required');
        return;
      }

      try {
        setError('');
        setLoading(true);

        const response = await authApi.login(data.email, data.password);
        login(response.token, response.user);

        const redirectPath = localStorage.getItem('owtranet-redirect-after-login');
        if (redirectPath) {
          localStorage.removeItem('owtranet-redirect-after-login');
          window.location.replace(redirectPath);
        } else {
          navigate('/dashboard');
        }
      } catch (err: any) {
        const errorData = err.response?.data;
        let errorMessage = errorData?.error || 'Login failed. Please try again.';

        // Use the detailed message if available
        if (errorData?.message) {
          errorMessage = errorData.message;
        }

        console.error('Login failed:', {
          email: data.email,
          error: errorMessage,
          fullError: errorData,
          status: err.response?.status,
          userNotFound: errorData?.userNotFound,
          incorrectPassword: errorData?.incorrectPassword
        });

        setError(errorMessage);
        // Keep error visible for at least 10 seconds
        setTimeout(() => {
          // Don't clear if a different error has been set
          setError(current => current === errorMessage ? '' : current);
        }, 10000);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to {companyName} Intranet
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Internal collaboration platform
          </p>
        </div>

        {/* Email sent confirmation */}
        {emailSent ? (
          <div className="bg-white shadow-lg rounded-lg p-8">
            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Check Your Email!</h3>
              <p className="text-gray-600">
                We've sent a login link to <strong>{emailForAuth}</strong>
              </p>
              {countdown > 0 && (
                <p className="text-sm text-gray-500 mt-2">
                  Link expires in {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                </p>
              )}
            </div>

            {showOtpInput && (
              <div className="space-y-4">
                <div className="border-t pt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Or enter the 6-digit code from your email:
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-widest font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="000000"
                    autoComplete="one-time-code"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleOtpVerification}
                  disabled={isLoading || otpCode.length !== 6}
                  className="w-full py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Verifying...' : 'Verify Code'}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start">
                <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setEmailSent(false);
                setShowOtpInput(false);
                setOtpCode('');
                setError('');
              }}
              className="w-full mt-4 text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back to login
            </button>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
            {requireAgreement && (
              <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg">
                <p className="font-medium">Agreement Required</p>
                <p className="text-sm">After logging in, you'll be redirected to sign the required team agreement.</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-start">
                <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Auth method selector */}
            <div className="flex rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setAuthMethod('password')}
                className={`flex-1 flex items-center justify-center py-2 px-4 rounded-md font-medium transition-all ${
                  authMethod === 'password'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Lock className="h-4 w-4 mr-2" />
                Password
              </button>
              <button
                type="button"
                onClick={() => setAuthMethod('email')}
                className={`flex-1 flex items-center justify-center py-2 px-4 rounded-md font-medium transition-all ${
                  authMethod === 'email'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Mail className="h-4 w-4 mr-2" />
                Email Link
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {authMethod === 'email' ? 'Email Address' : 'Email or Username'}
                </label>
                <div className="mt-1 relative">
                  <input
                    {...register('email')}
                    type={authMethod === 'email' ? 'email' : 'text'}
                    autoComplete="username"
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={authMethod === 'email' ? 'Enter your email' : 'Enter your email or username'}
                  />
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              {authMethod === 'password' && (
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <div className="mt-1 relative">
                    <input
                      {...register('password')}
                      type="password"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter your password"
                    />
                    <Key className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  </div>
                  {errors.password && (
                    <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? (
                'Processing...'
              ) : (
                <>
                  {authMethod === 'email' ? 'Send Login Link' : 'Sign In'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </button>

            <div className="flex items-center justify-between text-sm">
              <Link to="/register" className="text-blue-600 hover:text-blue-500">
                Create an account
              </Link>
              {authMethod === 'password' && (
                <Link to="/forgot-password" className="text-gray-600 hover:text-gray-900">
                  Forgot your password?
                </Link>
              )}
            </div>

            {authMethod === 'email' && (
              <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-700">
                  <strong>🔐 Secure & Convenient:</strong> We'll send you a one-time login link that works instantly.
                  The email will also include a 6-digit code you can enter if you're checking email on a different device.
                </p>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;