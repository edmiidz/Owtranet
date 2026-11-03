import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  User, 
  Github, 
  Mail, 
  Phone, 
  Calendar,
  Edit3,
  Camera,
  ExternalLink,
  MessageSquare,
  GitBranch,
  FileText,
  CheckCircle,
  AlertTriangle,
  Bot
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import AiAgentPanel from '../components/AiAgentPanel';
import { useBrandingStore } from '../stores/brandingStore';
import { usersApi, githubApi, agreementsApi, payrollApi } from '../utils/api';
import type { User as UserType, GitHubIssue, Post, UserAgreement, MaskedPayrollDetails, RevealedPayrollDetails, PayrollFormData } from '../types';
import LinkifiedText from '../components/LinkifiedText';

// Masked payroll details card. Owner sees masked values + edit form; an admin
// viewing someone else's profile can reveal full values through the audited
// endpoint (every reveal is written to payroll_details_access_log).
const PayrollDetailsCard: React.FC<{ profileUserId: number; isOwnProfile: boolean; isAdmin: boolean }> = ({
  profileUserId, isOwnProfile, isAdmin
}) => {
  const [masked, setMasked] = useState<MaskedPayrollDetails | null>(null);
  const [revealed, setRevealed] = useState<RevealedPayrollDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PayrollFormData>({});
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwnProfile) { setLoaded(true); return; }
    payrollApi.getMine()
      .then(r => setMasked(r.payroll))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [isOwnProfile, profileUserId]);

  const reveal = async () => {
    if (!confirm('Reveal full payroll details? This access will be logged.')) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const r = await payrollApi.adminReveal(profileUserId);
      setRevealed(r.payroll);
    } catch (e: any) {
      setErrorMsg(e.response?.data?.error || 'Failed to reveal payroll details');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErrorMsg('');
    setMessage('');
    try {
      const payload: PayrollFormData = {};
      (Object.keys(form) as (keyof PayrollFormData)[]).forEach(k => {
        if (form[k] !== undefined && String(form[k]).trim() !== '') payload[k] = form[k];
      });
      const r = await payrollApi.updateMine(payload);
      setMasked(r.payroll);
      setMessage('Payroll details updated.');
      setEditing(false);
      setForm({});
    } catch (e: any) {
      setErrorMsg(e.response?.data?.error || 'Failed to update payroll details');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-3 flex items-center">
        <FileText className="h-4 w-4 mr-2" />
        Payroll Details
      </h4>

      {errorMsg && <p className="text-sm text-red-600 mb-2">{errorMsg}</p>}
      {message && <p className="text-sm text-green-600 mb-2">{message}</p>}

      {isOwnProfile ? (
        <>
          {masked && (masked.has_sin || masked.has_bank || masked.address_line1) ? (
            <div className="p-3 bg-white rounded border text-sm text-gray-700 space-y-1">
              {masked.sin_masked && <p>SIN: <span className="font-mono">{masked.sin_masked}</span></p>}
              {masked.bank_account_masked && <p>Bank account: <span className="font-mono">{masked.bank_account_masked}</span></p>}
              {masked.address_line1 && (
                <p>Address: {masked.address_line1}{masked.address_line2 ? `, ${masked.address_line2}` : ''}, {masked.city}, {masked.province} {masked.postal_code}</p>
              )}
              {masked.date_of_birth && <p>Date of birth: {String(masked.date_of_birth).slice(0, 10)}</p>}
              <p className="text-xs text-gray-400">Encrypted at rest • used only for payroll/CRA reporting • last updated {new Date(masked.updated_at).toLocaleDateString()}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No payroll details on file.</p>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="mt-3 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            {editing ? 'Cancel' : 'Edit payroll details'}
          </button>

          {editing && (
            <div className="mt-3 p-3 bg-white rounded border space-y-3">
              <p className="text-xs text-gray-500">Fill only the fields you want to change; the rest stay as they are. Data is encrypted before storage.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input type="text" autoComplete="off" placeholder="SIN (123-456-789)" value={form.sin || ''} onChange={e => setForm({ ...form, sin: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Institution # (3 digits)" value={form.bank_institution || ''} onChange={e => setForm({ ...form, bank_institution: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Transit # (5 digits)" value={form.bank_transit || ''} onChange={e => setForm({ ...form, bank_transit: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Account # (7-12 digits)" value={form.bank_account || ''} onChange={e => setForm({ ...form, bank_account: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Address line 1" value={form.address_line1 || ''} onChange={e => setForm({ ...form, address_line1: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Address line 2" value={form.address_line2 || ''} onChange={e => setForm({ ...form, address_line2: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="City" value={form.city || ''} onChange={e => setForm({ ...form, city: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Province (BC)" value={form.province || ''} onChange={e => setForm({ ...form, province: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="text" autoComplete="off" placeholder="Postal code (V2S 7M8)" value={form.postal_code || ''} onChange={e => setForm({ ...form, postal_code: e.target.value })} className="p-2 border border-gray-300 rounded" />
                <input type="date" autoComplete="off" placeholder="Date of birth" value={form.date_of_birth || ''} onChange={e => setForm({ ...form, date_of_birth: e.target.value })} className="p-2 border border-gray-300 rounded" />
              </div>
              <p className="text-xs text-gray-500">Note: changing SIN or all three banking fields together replaces the stored values. Partial banking changes are rejected — enter institution, transit, and account together.</p>
              <button onClick={save} disabled={busy} className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        <>
          {revealed ? (
            <div className="p-3 bg-white rounded border text-sm text-gray-700 space-y-1">
              {revealed.sin && <p>SIN: <span className="font-mono">{revealed.sin}</span></p>}
              {revealed.bank_institution && (
                <p>Direct deposit: <span className="font-mono">{revealed.bank_institution} / {revealed.bank_transit} / {revealed.bank_account}</span> (institution / transit / account)</p>
              )}
              {revealed.address_line1 && (
                <p>Address: {revealed.address_line1}{revealed.address_line2 ? `, ${revealed.address_line2}` : ''}, {revealed.city}, {revealed.province} {revealed.postal_code}</p>
              )}
              {revealed.date_of_birth && <p>Date of birth: {String(revealed.date_of_birth).slice(0, 10)}</p>}
              <p className="text-xs text-amber-600 font-medium">This access has been logged.</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={reveal}
                disabled={busy}
                className="px-3 py-1 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? 'Loading…' : 'Reveal payroll details'}
              </button>
              <span className="text-xs text-amber-700">⚠ Every reveal is recorded in the payroll access log.</span>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

const profileUpdateSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address')
    .refine((email) => {
      const domain = useBrandingStore.getState().companyEmailDomain;
      return !email || !domain || !email.endsWith(`@${domain}`);
    }, 'Personal email cannot be a company email address. Use a personal email like Gmail, Yahoo, etc.')
    .optional(),
  other_emails: z.string()
    .max(500, 'Other emails cannot exceed 500 characters')
    .optional()
    .or(z.literal('')),
  bio: z.string().max(500, 'Bio cannot exceed 500 characters').optional(),
  department: z.string().max(100, 'Department cannot exceed 100 characters').optional(),
  position: z.string().max(100, 'Position cannot exceed 100 characters').optional(),
  company: z.string().max(100, 'Company cannot exceed 100 characters').optional(),
  intranet_username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username cannot exceed 30 characters')
    .regex(/^[a-zA-Z0-9_\-]+$/, 'Username can only contain letters, numbers, underscores, and dashes')
    .optional(),
  github_username: z.string()
    .max(39, 'GitHub username cannot exceed 39 characters')
    .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, 'Invalid GitHub username format')
    .optional()
    .or(z.literal('')),
  calendar_link: z.string()
    .url('Please enter a valid URL')
    .optional()
    .or(z.literal('')),
  email_notification_preference: z.enum(['personal', 'company', 'both']).optional(),
  email_provider: z.enum(['self_hosted', 'microsoft_365', 'google_workspace']).optional(),
  agent_embed_code: z.string()
    .max(2000, 'Agent embed code cannot exceed 2000 characters')
    .optional()
    .or(z.literal('')),
});

type ProfileUpdateFormData = z.infer<typeof profileUpdateSchema>;

const ProfilePage: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser, updateUser } = useAuthStore();
  const { companyName, companyEmailDomain, emailProviders, defaultEmailProvider } = useBrandingStore();
  const [profile, setProfile] = useState<UserType | null>(null);
  const [githubIssues, setGithubIssues] = useState<GitHubIssue[]>([]);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [userAgreements, setUserAgreements] = useState<UserAgreement[]>([]);

  // Check if viewing own profile (handle both username and ID formats)
  const isOwnProfile = username?.startsWith('id:') 
    ? parseInt(username.substring(3)) === currentUser?.id
    : currentUser?.intranet_username === username || currentUser?.github_username === username;
  const canEdit = isOwnProfile || currentUser?.role === 'admin';
  const isAdmin = currentUser?.role === 'admin';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileUpdateFormData>({
    resolver: zodResolver(profileUpdateSchema),
  });

  useEffect(() => {
    const loadProfile = async () => {
      if (!username) return;
      
      try {
        const userData = await usersApi.getUser(username);
        setProfile(userData);
        
        // Extract posts and GitHub issues from the API response (cast to any for extended data)
        const userDataExtended = userData as any;
        
        if (userDataExtended.posts) {
          setUserPosts(userDataExtended.posts);
        }
        
        if (userDataExtended.github_issues) {
          setGithubIssues(userDataExtended.github_issues);
        }
        
        // Also try to load GitHub issues separately if not included
        if (!userDataExtended.github_issues || userDataExtended.github_issues.length === 0) {
          try {
            const issues = await githubApi.getUserIssues(username);
            setGithubIssues(issues);
          } catch (error) {
            console.error('Failed to load GitHub issues:', error);
          }
        }

        // Set form defaults
        // Load agreement information for admins or own profile
        if (isAdmin || isOwnProfile) {
          try {
            const agreements = await agreementsApi.getUserAgreements(userData.id);
            setUserAgreements(agreements);
          } catch (error) {
            console.error('Failed to load agreement information:', error);
          }
        }

        reset({
          bio: userData.bio || '',
          department: userData.department || '',
          position: userData.position || '',
          company: userData.company || '',
          intranet_username: userData.intranet_username || '',
          github_username: userData.github_username || '',
          calendar_link: userData.calendar_link || '',
          email_notification_preference: userData.email_notification_preference || 'company',
          email_provider: userData.email_provider || defaultEmailProvider,
          agent_embed_code: userData.agent_embed_code || '',
        });

      } catch (error) {
        console.error('Failed to load profile:', error);
        setError('Failed to load user profile');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [username, reset]);

  const onUpdateProfile = async (data: ProfileUpdateFormData) => {
    if (!profile) return;

    try {
      setError('');
      setSuccess('');
      
      await usersApi.updateUser(profile.id, data);
      setProfile(prev => prev ? { ...prev, ...data } : null);
      
      // Update auth store if this is the current user's profile
      if (isOwnProfile && currentUser) {
        updateUser(data);
      }
      
      setSuccess('Profile updated successfully!');
      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !profile) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5MB');
      return;
    }

    try {
      setError('');
      setUploadingAvatar(true);
      
      const response = await usersApi.uploadAvatar(profile.id, file);
      
      setProfile(prev => prev ? { ...prev, avatar_url: response.avatar_url } : null);
      setSuccess('Profile picture updated successfully!');
      
      // Update auth store if it's the current user
      if (isOwnProfile && currentUser) {
        const { updateUser } = useAuthStore.getState();
        updateUser({ avatar_url: response.avatar_url });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload profile picture');
    } finally {
      setUploadingAvatar(false);
      // Reset the input
      event.target.value = '';
    }
  };

  const ProfilePicture: React.FC<{ user: UserType; size?: 'sm' | 'md' | 'lg' | 'xl' }> = ({ 
    user, 
    size = 'lg' 
  }) => {
    const sizeClasses = {
      sm: 'h-8 w-8 text-sm',
      md: 'h-12 w-12 text-lg',
      lg: 'h-24 w-24 text-2xl',
      xl: 'h-32 w-32 text-4xl'
    };

    if (user.avatar_url) {
      return (
        <img
          src={user.avatar_url}
          alt={`${user.name} profile`}
          className={`${sizeClasses[size]} rounded-full object-cover border-4 border-white shadow-lg`}
        />
      );
    }

    return (
      <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center border-4 border-white shadow-lg`}>
        <span className="font-bold text-white">
          {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
        </span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="animate-pulse">
            <div className="h-32 w-32 bg-gray-300 rounded-full mx-auto mb-4"></div>
            <div className="h-6 bg-gray-300 rounded w-48 mx-auto mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-32 mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-12">
        <User className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">User not found</h2>
        <p className="text-gray-600">The user @{username} doesn't exist.</p>
        <Link to="/dashboard" className="btn btn-primary mt-4 inline-flex">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // AI agents get a distinct header and the agent hub; agent-only
  // accounts (role 'system') also skip the human-only admin sections.
  const agent = profile.account_type === 'ai_agent' ? profile.ai_agent || null : null;
  const isAgentOnlyAccount = !!agent && profile.role === 'system';

  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <div className={`card p-8 ${agent ? 'border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-white' : ''}`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
          {/* Profile Picture */}
          <div className="relative">
            <ProfilePicture user={profile} size="xl" />
            {canEdit && (
              <div className="absolute bottom-0 right-0">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                  id="avatar-upload"
                  disabled={uploadingAvatar}
                />
                <label
                  htmlFor="avatar-upload"
                  className={`
                    p-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors cursor-pointer flex items-center justify-center
                    ${uploadingAvatar ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <Camera className="h-4 w-4" />
                </label>
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{profile.name}</h1>
                {agent ? (
                  <p className="text-lg text-gray-600">@{agent.handle}</p>
                ) : (profile.intranet_username || profile.github_username) && (
                  <p className="text-lg text-gray-600">@{profile.intranet_username || profile.github_username}</p>
                )}
                {agent?.tagline && !profile.position && (
                  <p className="text-gray-700 mt-1">{agent.tagline}</p>
                )}
                {profile.position && (
                  <p className="text-gray-700 mt-1">{profile.position}</p>
                )}
                {profile.department && profile.company && (
                  <p className="text-gray-600">{profile.department} at {profile.company}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  {agent && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-violet-600 text-white">
                      <Bot className="h-3.5 w-3.5" />
                      AI Agent{agent.kind === 'role' ? ' · Worker role' : agent.kind === 'voice' ? ' · Voice' : ' · System'}
                    </span>
                  )}
                  {!isAgentOnlyAccount && (
                  <span className={`
                    px-3 py-1 rounded-full text-xs font-medium
                    ${profile.role === 'admin' ? 'bg-red-100 text-red-800' :
                      profile.role === 'moderator' ? 'bg-purple-100 text-purple-800' :
                      profile.role === 'user' ? 'bg-green-100 text-green-800' :
                      'bg-yellow-100 text-yellow-800'}
                  `}>
                    {profile.role?.charAt(0).toUpperCase() + profile.role?.slice(1)}
                  </span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                {/* Message button for other members — AI agents answer DMs too */}
                {!isOwnProfile && currentUser && (
                  <button
                    onClick={() => {
                      // Navigate to messages page with this user (agents by id:
                      // their handle may not be their intranet username)
                      const userIdentifier = agent ? `id:${profile.id}` : profile.intranet_username || profile.github_username || `id:${profile.id}`;
                      window.location.href = `/messages?user=${userIdentifier}`;
                    }}
                    className={agent ? 'btn bg-violet-600 hover:bg-violet-700 text-white' : 'btn btn-primary'}
                    title={agent ? `Chat with ${profile.name} (AI agent)` : `Send message to ${profile.name}`}
                  >
                    {agent ? <Bot className="h-4 w-4 mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                    Message
                  </button>
                )}
                
                {canEdit && (
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="btn btn-secondary"
                  >
                    <Edit3 className="h-4 w-4 mr-2" />
                    {isEditing ? 'Cancel' : 'Edit Profile'}
                  </button>
                )}
              </div>
            </div>

            {/* Contact Info */}
            <div className="mt-4 flex flex-wrap gap-4">
              <div className="flex items-center text-gray-600">
                <Mail className="h-4 w-4 mr-2" />
                <a 
                  href={`mailto:${profile.company_email || profile.email}`}
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {profile.company_email || profile.email}
                </a>
              </div>
              {profile.telephone && (
                <div className="flex items-center text-gray-600">
                  <Phone className="h-4 w-4 mr-2" />
                  <span>{profile.telephone}</span>
                </div>
              )}
              {profile.calendar_link && (
                <div className="flex items-center text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  <a 
                    href={profile.calendar_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline flex items-center"
                  >
                    Book a meeting
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </div>
              )}
              {profile.github_username && (
                <div className="flex items-center text-gray-600">
                  <Github className="h-4 w-4 mr-2" />
                  <a
                    href={`https://github.com/${profile.github_username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary-600 flex items-center"
                  >
                    {profile.github_username}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </div>
              )}
              <div className="flex items-center text-gray-600">
                <Calendar className="h-4 w-4 mr-2" />
                <span>Joined {new Date(profile.created_at).toLocaleDateString('en-CA')}</span>
              </div>
              {profile.last_login && (
                <div className="flex items-center text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  <span>Last login: {new Date(profile.last_login).toLocaleString('en-CA', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZoneName: 'short'
                  }).replace(',', '')}</span>
                </div>
              )}
              {!profile.last_login && !isAgentOnlyAccount && (
                <div className="flex items-center text-gray-600">
                  <Calendar className="h-4 w-4 mr-2" />
                  <span className="text-yellow-600">Never logged in</span>
                </div>
              )}
            </div>

            {/* Agreement Status (Admin view or own profile) */}
            {(isAdmin || isOwnProfile) && !isAgentOnlyAccount && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                  <FileText className="h-4 w-4 mr-2" />
                  Agreements
                </h4>

                {userAgreements.length > 0 ? (
                  <div className="space-y-2">
                    {userAgreements.map((agreement) => (
                      <div key={agreement.id} className="flex items-center justify-between p-3 bg-white rounded border">
                        <div className="flex items-center">
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
                          <div>
                            <span className="font-medium text-gray-900">
                              {agreement.title || `Version ${agreement.version}`}
                            </span>
                            <span className={`ml-2 px-2 py-0.5 text-xs rounded-full font-medium ${
                              agreement.agreement_type === 'employment' ? 'bg-purple-100 text-purple-700'
                              : agreement.agreement_type === 'custom' ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                            }`}>
                              {agreement.agreement_type || 'team'}
                            </span>
                            <p className="text-sm text-gray-500">
                              v{agreement.version} • Signed on {new Date(agreement.signed_at).toLocaleDateString()} as "{agreement.full_name}"
                            </p>
                          </div>
                        </div>
                        {isAdmin && (
                          <Link
                            to={`/admin/agreement/${agreement.id}`}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            View Contract
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 mr-2" />
                    <div>
                      <span className="font-medium text-yellow-800">Agreement Required</span>
                      <p className="text-sm text-yellow-700">
                        {isOwnProfile ? 'You must sign the team agreement to access the platform.' : 'This user has not signed the team agreement yet.'}
                      </p>
                    </div>
                    {isOwnProfile && (
                      <Link 
                        to="/agreement"
                        className="ml-auto px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700"
                      >
                        Sign Agreement
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payroll details (masked; admin reveal is audited) */}
            {(isAdmin || isOwnProfile) && profile && !isAgentOnlyAccount && (
              <PayrollDetailsCard
                profileUserId={profile.id}
                isOwnProfile={!!isOwnProfile}
                isAdmin={!!isAdmin}
              />
            )}
          </div>
        </div>

        {/* Missing GitHub Username Notification */}
        {isOwnProfile && !profile.github_username && (
          <div className="mt-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-orange-900 mb-2">GitHub Username Missing</h4>
                <p className="text-sm text-orange-800 mb-3">
                  A GitHub username is required for full platform functionality, including issue tracking and code collaboration.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="btn btn-primary btn-sm"
                  >
                    Add GitHub Username
                  </button>
                  <a
                    href="https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-sm flex items-center"
                  >
                    Create GitHub Account
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bio */}
        {profile.bio && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-2">About</h3>
            <p className="text-gray-700 whitespace-pre-line break-words"><LinkifiedText text={profile.bio} /></p>
          </div>
        )}

        {/* AI Agent Widget */}
        {profile.agent_embed_code && profile.agent_embed_code.trim() ? (
          <AIAgentWidget 
            embedCode={profile.agent_embed_code} 
            userName={profile.name} 
          />
        ) : agent?.elevenlabs_agent_id && /^[\w-]+$/.test(agent.elevenlabs_agent_id) ? (
          <AIAgentWidget
            embedCode={`<elevenlabs-convai agent-id="${agent.elevenlabs_agent_id}"></elevenlabs-convai>`}
            userName={profile.name}
            title={`Talk to ${profile.name} by voice`}
          />
        ) : null}
      </div>

      {/* The agent's three representations */}
      {agent && <AiAgentPanel agent={agent} name={profile.name} />}

      {/* Edit Profile Form */}
      {isEditing && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Edit Profile</h2>
          
          <form onSubmit={handleSubmit(onUpdateProfile)} className="space-y-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Personal Email Address
              </label>
              <input
                {...register('email')}
                type="email"
                className="form-input"
                placeholder="your.email@example.com"
                defaultValue={profile?.email || ''}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {`Your personal email address for account notifications and password resets. This is separate from your @${companyEmailDomain} email.`}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Other Email Addresses
              </label>
              <input
                {...register('other_emails')}
                type="text"
                className="form-input"
                placeholder="email1@example.com, email2@example.com"
                defaultValue={profile?.other_emails || ''}
              />
              {errors.other_emails && (
                <p className="mt-1 text-sm text-red-600">{errors.other_emails.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {`Additional email addresses you may use to submit receipts to intranet@${companyEmailDomain}. Separate multiple emails with commas.`}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Position
                </label>
                <input
                  {...register('position')}
                  type="text"
                  className="form-input"
                  placeholder="e.g., Senior Developer, Project Manager"
                />
                {errors.position && (
                  <p className="mt-1 text-sm text-red-600">{errors.position.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <input
                  {...register('department')}
                  type="text"
                  className="form-input"
                  placeholder="e.g., Engineering, Sales, Marketing"
                />
                {errors.department && (
                  <p className="mt-1 text-sm text-red-600">{errors.department.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company
              </label>
              <input
                {...register('company')}
                type="text"
                className="form-input"
                placeholder={`e.g., ${companyName}, Client Company`}
              />
              {errors.company && (
                <p className="mt-1 text-sm text-red-600">{errors.company.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Intranet Username
              </label>
              <input
                {...register('intranet_username')}
                type="text"
                className="form-input"
                placeholder="e.g., johnsmith, developer123"
              />
              <p className="mt-1 text-xs text-gray-500">
                Used for @mentions and profile links. 3-30 characters, letters/numbers/underscore/dash only.
              </p>
              {errors.intranet_username && (
                <p className="mt-1 text-sm text-red-600">{errors.intranet_username.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GitHub Username
              </label>
              <input
                {...register('github_username')}
                type="text"
                className="form-input"
                placeholder="e.g., octocat, yourname"
              />
              <p className="mt-1 text-xs text-gray-500">
                Your GitHub username for issue tracking and code collaboration. Must match your actual GitHub account.
              </p>
              {errors.github_username && (
                <p className="mt-1 text-sm text-red-600">{errors.github_username.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Calendar Link
              </label>
              <input
                {...register('calendar_link')}
                type="url"
                className="form-input"
                placeholder="e.g., https://cal.com/yourname or https://calendly.com/yourname"
              />
              <p className="mt-1 text-xs text-gray-500">
                Your booking link from Cal.com, Calendly, or other calendar service for easy scheduling.
              </p>
              {errors.calendar_link && (
                <p className="mt-1 text-sm text-red-600">{errors.calendar_link.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email &amp; Calendar Provider
              </label>
              <select
                {...register('email_provider')}
                className="form-input"
              >
                {emailProviders.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Where your work mailbox and calendar live. Webmail and the @{companyEmailDomain} email request are only available with the self-hosted option.
              </p>
              {errors.email_provider && (
                <p className="mt-1 text-sm text-red-600">{errors.email_provider.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Notification Preference
              </label>
              <select
                {...register('email_notification_preference')}
                className="form-input"
              >
                <option value="company">{companyName} Email ({profile?.company_email || 'Not set'})</option>
                <option value="personal">Personal Email ({profile?.email})</option>
                <option value="both">Both Addresses</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Choose which email address to receive notifications on when you're offline (30+ minutes since last login).
              </p>
              {errors.email_notification_preference && (
                <p className="mt-1 text-sm text-red-600">{errors.email_notification_preference.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bio
              </label>
              <textarea
                {...register('bio')}
                rows={4}
                className="form-input"
                placeholder="Tell us about yourself, your role, and what you're working on..."
              />
              {errors.bio && (
                <p className="mt-1 text-sm text-red-600">{errors.bio.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                AI Agent Embed Code
              </label>
              <textarea
                {...register('agent_embed_code')}
                rows={3}
                className="form-input font-mono text-sm"
                placeholder='<elevenlabs-convai agent-id="your_agent_id"></elevenlabs-convai>&#10;<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>'
              />
              <p className="mt-1 text-xs text-gray-500">
                Paste your AI agent embed code from ElevenLabs or other providers. This will add an interactive voice agent to your profile page.
              </p>
              {errors.agent_embed_code && (
                <p className="mt-1 text-sm text-red-600">{errors.agent_embed_code.message}</p>
              )}
            </div>

            <div className="flex space-x-3">
              <button type="submit" className="btn btn-primary">
                Save Changes
              </button>
              <button 
                type="button" 
                onClick={() => setIsEditing(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* API Token Management - Only show for own profile */}
      {isOwnProfile && (
        <div className="card p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">API Token</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 mb-4">
              Generate a personal API token to create posts and access the API as yourself. 
              This token will be associated with your account and posts created via API will show as authored by you.
            </p>

            {/* Error/Success Messages */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
                {success}
              </div>
            )}
            
            <div className="space-y-3">
              <button 
                onClick={async (e) => {
                  e.preventDefault();
                  console.log('Generate API Token button clicked');
                  
                  try {
                    setError('');
                    setSuccess('');
                    
                    console.log('Making API request to /api/user/generate-token');
                    const response = await fetch('/api/user/generate-token', {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
                        'Content-Type': 'application/json'
                      }
                    });
                    
                    console.log('API response status:', response.status);
                    
                    if (response.ok) {
                      const data = await response.json();
                      console.log('Token generated successfully:', data);
                      setSuccess(`API Token generated: ${data.token}`);
                    } else if (response.status === 401 || response.status === 403) {
                      setError('Authentication expired. Please refresh the page and try again.');
                    } else {
                      const errorData = await response.json();
                      console.error('API error:', errorData);
                      setError(errorData.error || 'Failed to generate token');
                    }
                  } catch (err: any) {
                    console.error('Token generation error:', err);
                    setError('Failed to generate token: ' + err.message);
                  }
                }}
                className="btn btn-primary btn-sm"
              >
                Generate New API Token
              </button>
              
              <p className="text-xs text-gray-600">
                <strong>Security:</strong> Store this token securely. It provides full access to your account via API.
                <br />
                <strong>Usage:</strong> Include in API requests as: <code>Authorization: Bearer YOUR_TOKEN</code>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* GitHub Issues */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <GitBranch className="h-5 w-5 mr-2" />
              GitHub Issues
            </h2>
            <span className="text-sm text-gray-500">{githubIssues.length} assigned</span>
          </div>

          {githubIssues.length > 0 ? (
            <div className="space-y-3">
              {githubIssues.slice(0, 5).map((issue) => (
                <div key={issue.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 hover:text-primary-600 flex items-center"
                      >
                        #{issue.issue_number} {issue.title}
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                      <div className="mt-1 text-xs text-gray-500">
                        {issue.state} • Updated {new Date(issue.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className={`
                      px-2 py-1 rounded-full text-xs font-medium
                      ${issue.state === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}
                    `}>
                      {issue.state}
                    </span>
                  </div>
                </div>
              ))}
              
              {githubIssues.length > 5 && (
                <p className="text-sm text-gray-500 text-center">
                  And {githubIssues.length - 5} more issues...
                </p>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              <GitBranch className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No GitHub issues assigned</p>
            </div>
          )}
        </div>

        {/* Recent Posts */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <MessageSquare className="h-5 w-5 mr-2" />
              Recent Posts
            </h2>
            <span className="text-sm text-gray-500">{userPosts.length} posts</span>
          </div>

          {userPosts.length > 0 ? (
            <div className="space-y-3">
              {userPosts.map((post) => (
                <div key={post.id} className="border border-gray-200 rounded-lg p-4">
                  <Link
                    to={`/forum/post/${post.slug}`}
                    className="font-medium text-gray-900 hover:text-primary-600 block"
                  >
                    {post.title}
                  </Link>
                  <div className="mt-1 text-xs text-gray-500">
                    {new Date(post.created_at).toLocaleDateString()} • {post.view_count} views
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No forum posts yet</p>
              {isOwnProfile && (
                <Link to="/forum/create" className="btn btn-primary mt-4 inline-flex">
                  Create First Post
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Activity Stats */}
      <div className="card p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Activity Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary-600">{userPosts.length}</div>
            <div className="text-sm text-gray-600">Forum Posts</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{githubIssues.filter(i => i.state === 'open').length}</div>
            <div className="text-sm text-gray-600">Open Issues</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-600">{githubIssues.filter(i => i.state === 'closed').length}</div>
            <div className="text-sm text-gray-600">Closed Issues</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {profile.last_login ? Math.floor((Date.now() - new Date(profile.last_login).getTime()) / (1000 * 60 * 60 * 24)) : '—'}
            </div>
            <div className="text-sm text-gray-600">Days Since Login</div>
          </div>
          {profile.total_investment !== undefined && (
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                ${Number(profile.total_investment || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-sm text-gray-600">Total Investment</div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Status */}
      {uploadingAvatar && (
        <div className="card p-6 bg-blue-50 border-blue-200">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mr-3"></div>
            <p className="text-blue-800">Uploading profile picture...</p>
          </div>
        </div>
      )}

      {/* Profile Picture Instructions */}
      {isOwnProfile && (
        <div className="card p-6 bg-blue-50 border-blue-200">
          <div className="flex items-start">
            <Camera className="h-6 w-6 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-900 mb-2">Profile Picture Options</h3>
              <div className="text-sm text-blue-800 space-y-3">
                <div>
                  <p className="font-medium">Option 1: Upload Custom Picture</p>
                  <p>Click the camera icon on your profile picture to upload a custom image (JPG, PNG, up to 5MB)</p>
                </div>
                <div>
                  <p className="font-medium">Option 2: Use GitHub Avatar</p>
                  <ol className="list-decimal list-inside space-y-1 ml-4">
                    <li>Go to <a href="https://github.com/settings/profile" target="_blank" rel="noopener noreferrer" className="underline">GitHub Profile Settings</a></li>
                    <li>Upload a new profile picture</li>
                    <li>Refresh this page to sync your GitHub avatar</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// AI Agent Widget Component
interface AIAgentWidgetProps {
  embedCode: string;
  userName: string;
  title?: string;
}

const AIAgentWidget: React.FC<AIAgentWidgetProps> = ({ embedCode, userName, title }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadElevenLabsScript = async () => {
      try {
        // Check if script is already loaded
        if (document.querySelector('script[src*="@elevenlabs/convai-widget-embed"]')) {
          setIsLoaded(true);
          return;
        }

        // Create and load the script
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
        script.async = true;
        script.type = 'text/javascript';
        
        script.onload = () => {
          setIsLoaded(true);
        };
        
        script.onerror = () => {
          setError('Failed to load AI agent script');
        };

        document.head.appendChild(script);
      } catch (err) {
        setError('Error initializing AI agent');
      }
    };

    if (embedCode && embedCode.includes('elevenlabs-convai')) {
      loadElevenLabsScript();
    }
  }, [embedCode]);

  if (error) {
    return (
      <div className="mt-6 pt-6 border-t border-gray-200">
        <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
          <span className="mr-2">🤖</span>
          {title || `${userName}'s AI Agent`}
        </h3>
        <div className="text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-200">
      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
        <span className="mr-2">🤖</span>
        {title || `${userName}'s AI Agent`}
      </h3>
      
      {!isLoaded && (
        <div className="text-sm text-gray-500">
          Loading AI agent...
        </div>
      )}
      
      <div 
        className="agent-embed-container"
        dangerouslySetInnerHTML={{ 
          __html: embedCode.replace(/<script[^>]*>.*?<\/script>/gi, '') 
        }}
      />
    </div>
  );
};

export default ProfilePage;