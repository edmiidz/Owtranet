import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import SearchAdaptersTab from '../components/SearchAdaptersTab';
import { 
  Search,
  Users, 
  UserPlus, 
  Mail, 
  Settings, 
  Copy, 
  Check, 
  Shield,
  CheckCircle,
  XCircle,
  Trash2,
  UserCheck,
  Link,
  FileText,
  DollarSign,
  Eye
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { invitesApi, emailRequestsApi, usersApi, quicklinksApi, agreementsApi } from '../utils/api';
import type { User, EmailRequest, Quicklink } from '../types';
import QuicklinkForm from '../components/QuicklinkForm';

const inviteSchema = z.object({
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  name: z.string().min(1, 'Name is required'),
  expires_days: z.number().min(1).max(30).default(7),
});

type InviteFormData = z.infer<typeof inviteSchema>;

const AdminPage: React.FC = () => {
  const { user } = useAuthStore();
  const { companyShortName, companyEmailDomain, baseCurrency } = useBrandingStore();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Get tab from URL or default to 'invites'
  const currentTab = searchParams.get('tab') as 'invites' | 'users' | 'emailrequests' | 'company-emails' | 'groups' | 'quicklinks' | 'agreements' | 'deliverables' | 'settings' || 'invites';
  const [activeTab, setActiveTab] = useState<'invites' | 'users' | 'emailrequests' | 'company-emails' | 'groups' | 'quicklinks' | 'agreements' | 'deliverables' | 'search-adapters' | 'settings'>(currentTab);
  const [invites, setInvites] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [emailRequests, setEmailRequests] = useState<EmailRequest[]>([]);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [serverAccounts, setServerAccounts] = useState<any[]>([]);
  const [serverStatus, setServerStatus] = useState<any>({});
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<any[]>([]);
  const [showCreateInviteLink, setShowCreateInviteLink] = useState(false);
  const [quicklinks, setQuicklinks] = useState<Quicklink[]>([]);
  const [showCreateQuicklink, setShowCreateQuicklink] = useState(false);
  const [editingQuicklink, setEditingQuicklink] = useState<Quicklink | null>(null);
  const [agreementVersions, setAgreementVersions] = useState<any[]>([]);
  const [agreementSignatures, setAgreementSignatures] = useState<any[]>([]);
  const [selectedAgreementVersion, setSelectedAgreementVersion] = useState<any>(null);
  const [showAgreementContent, setShowAgreementContent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<string>('');
  const [requestingAgreement, setRequestingAgreement] = useState<number | null>(null);

  // Custom agreement creation + per-user assignment management
  const emptyNewAgreement = {
    version: '',
    title: '',
    agreement_type: 'custom' as 'team' | 'employment' | 'custom',
    content: '',
    quiz_question: '',
    quiz_correct_answer: '',
    required_fields: [] as string[],
    confirmations: [] as { key: string; label: string }[],
    assign_to_user_ids: [] as number[],
  };
  const [showCreateAgreement, setShowCreateAgreement] = useState(false);
  const [newAgreement, setNewAgreement] = useState(emptyNewAgreement);
  const [newConfirmationLabel, setNewConfirmationLabel] = useState('');
  const [creatingAgreement, setCreatingAgreement] = useState(false);
  const [assignmentsVersion, setAssignmentsVersion] = useState<any>(null);
  const [versionAssignments, setVersionAssignments] = useState<any[]>([]);
  const [assignPickerUserId, setAssignPickerUserId] = useState<string>('');
  const [editingHourlyRates, setEditingHourlyRates] = useState<Record<number, string>>({});

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      expires_days: 7
    }
  });

  // Sync activeTab with URL parameter
  useEffect(() => {
    const urlTab = searchParams.get('tab') as typeof activeTab;
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [searchParams]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      
      switch (activeTab) {
        case 'invites':
          const [inviteData, inviteLinksResponse] = await Promise.all([
            invitesApi.getInvites(),
            fetch('/api/invite-links', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            })
          ]);
          
          setInvites(inviteData);
          
          if (inviteLinksResponse.ok) {
            const inviteLinksData = await inviteLinksResponse.json();
            setInviteLinks(inviteLinksData);
          }
          break;
        case 'users':
          const userData = await usersApi.getAllUsers();
          setUsers(userData);
          break;
        case 'emailrequests':
          const emailData = await emailRequestsApi.getEmailRequests();
          setEmailRequests(emailData);
          break;
        case 'company-emails':
          // Load server accounts and status
          const [accountsResponse, statusResponse] = await Promise.all([
            fetch('/api/admin/email/server-accounts', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            }),
            fetch('/api/admin/email/server-status', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            })
          ]);
          
          if (accountsResponse.ok && statusResponse.ok) {
            const accountsData = await accountsResponse.json();
            const statusData = await statusResponse.json();
            setServerAccounts(accountsData);
            setServerStatus(statusData);
          }
          break;
        case 'groups':
          const [groupsResponse, usersResponse] = await Promise.all([
            fetch('/api/admin/groups', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            }),
            usersApi.getAllUsers()
          ]);
          
          if (groupsResponse.ok) {
            const groupsData = await groupsResponse.json();
            setGroups(groupsData);
          }
          
          setUsers(usersResponse);
          break;
        case 'quicklinks':
          const quicklinksData = await quicklinksApi.getAdminQuicklinks();
          setQuicklinks(quicklinksData);
          break;
        case 'agreements':
          console.log('Loading agreements data...');
          const [versionsResponse, activityResponse] = await Promise.all([
            fetch('/api/admin/agreements/versions-with-stats', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            }),
            fetch('/api/admin/agreements/activity', {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
            })
          ]);
          
          console.log('Versions response status:', versionsResponse.status);
          console.log('Activity response status:', activityResponse.status);
          
          if (versionsResponse.ok) {
            const versionsData = await versionsResponse.json();
            console.log('Versions data:', versionsData);
            setAgreementVersions(versionsData);
            console.log('Set agreementVersions state, length:', versionsData.length);
          } else {
            console.error('Versions response error:', await versionsResponse.text());
          }
          
          if (activityResponse.ok) {
            const activityData = await activityResponse.json();
            console.log('Activity data:', activityData);
            setAgreementSignatures(activityData);
          } else {
            console.error('Activity response error:', await activityResponse.text());
          }

          // Users list for the custom-agreement assignment picker
          try {
            setUsers(await usersApi.getAllUsers());
          } catch (e) {
            console.error('Failed to load users for agreements tab:', e);
          }
          break;
        case 'deliverables':
          const deliverablesResponse = await fetch('/api/deliverables', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
          });
          if (deliverablesResponse.ok) {
            const deliverablesData = await deliverablesResponse.json();
            setDeliverables(deliverablesData);
          }
          break;
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setError('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const onCreateInvite = async (data: InviteFormData) => {
    try {
      setError('');
      setSuccess('');
      
      const inviteData = {
        ...data,
        email: data.email || undefined, // Convert empty string to undefined
      };
      
      const response = await invitesApi.createInvite(inviteData);
      setSuccess(`Invite created! Code: ${response.code}`);
      reset();
      loadData(); // Reload invites
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create invite');
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(type);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const updateUserRole = async (userId: number, newRole: string) => {
    try {
      await usersApi.updateUserRole(userId, newRole);
      setSuccess('User role updated successfully');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update user role');
    }
  };

  const updateUserHourlyRate = async (userId: number, hourlyRate: number | null) => {
    try {
      await usersApi.updateUserHourlyRate(userId, hourlyRate);
      setSuccess('Hourly rate updated successfully');
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update hourly rate');
    }
  };

  const approveEmailRequest = async (requestId: number, status: 'approved' | 'rejected', reason?: string) => {
    try {
      await emailRequestsApi.updateEmailRequest(requestId, { status, rejection_reason: reason });
      setSuccess(`Email request ${status} successfully`);
      loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update email request');
    }
  };

  const handleDeliverableAction = async (deliverableId: number, action: 'approved' | 'rejected', reason?: string) => {
    try {
      setError('');
      setSuccess('');
      
      const response = await fetch(`/api/deliverables/${deliverableId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: action,
          rejection_reason: reason
        })
      });

      if (response.ok) {
        setSuccess(`Deliverable ${action} successfully`);
        loadData(); // Reload deliverables
      } else {
        const errorData = await response.json();
        setError(errorData.error || `Failed to ${action} deliverable`);
      }
    } catch (err: any) {
      setError(`Failed to ${action} deliverable`);
    }
  };

  const deleteInvite = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this invitation? This action cannot be undone.')) {
      return;
    }
    
    try {
      setError('');
      setSuccess('');
      const response = await invitesApi.deleteInvite(id);
      setSuccess(response.message);
      loadData(); // Reload the invites list
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete invitation');
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
  };

  const handleCreateEmailAccount = async (userId: number, username: string, password: string) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch('/api/admin/email/create-account', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: userId, username, password })
      });

      if (response.ok) {
        const result = await response.json();
        setSuccess(`Email account ${result.email_address} created successfully!`);
        loadData(); // Reload server accounts
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create email account');
      }
    } catch (err: any) {
      setError('Failed to create email account');
    }
  };

  const handleLinkOrphanedAccount = async (accountId: number, userId: number) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch('/api/admin/email/link-account', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ account_id: accountId, user_id: userId })
      });

      if (response.ok) {
        setSuccess('Account linked successfully!');
        loadData(); // Reload server accounts
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to link account');
      }
    } catch (err: any) {
      setError('Failed to link account');
    }
  };


  const handleDeleteUser = async (userId: number) => {
    try {
      setError('');
      setSuccess('');
      
      const userData = users.find(u => u.id === userId);
      if (!userData) return;
      
      const confirmDelete = window.confirm(
        `Delete user account for ${userData.name}?\n\nEmail: ${userData.email}\n\n⚠️ WARNING: This will:\n• Permanently delete the user account\n• Remove all their posts and comments\n• Delete their profile and data\n• Cannot be undone\n\nAre you absolutely sure?`
      );
      
      if (!confirmDelete) return;
      
      // Double confirmation for safety
      const doubleConfirm = window.confirm(
        `FINAL CONFIRMATION\n\nThis will PERMANENTLY DELETE:\n• ${userData.name} (${userData.email})\n• All their posts and comments\n• All their data\n\nType YES in the next prompt to confirm.`
      );
      
      if (!doubleConfirm) return;
      
      const finalConfirm = window.prompt(
        `Type "DELETE" (in capital letters) to confirm deletion of ${userData.name}'s account:`
      );
      
      if (finalConfirm !== 'DELETE') {
        alert('User deletion cancelled - confirmation text did not match.');
        return;
      }
      
      // Call API to delete user
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        setSuccess(`User account for ${userData.name} has been permanently deleted.`);
        loadData(); // Reload users list
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete user account');
      }
    } catch (err: any) {
      setError('Failed to delete user account');
    }
  };

  const handleCreateGroup = async (groupData: any) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(groupData)
      });

      if (response.ok) {
        await response.json();
        setSuccess(`Group "${groupData.display_name}" created successfully!`);
        setShowCreateGroup(false);
        loadData(); // Reload groups
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create group');
      }
    } catch (err: any) {
      setError('Failed to create group');
    }
  };

  const handleToggleGroupArchived = async (group: any) => {
    const archiving = !!group.is_active;
    try {
      setError('');
      setSuccess('');

      const response = await fetch(`/api/admin/groups/${group.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_active: !archiving })
      });

      if (response.ok) {
        setSuccess(`Group "${group.display_name}" ${archiving ? 'archived' : 'restored'}`);
        setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_active: archiving ? 0 : 1 } : g));
      } else {
        const errorData = await response.json();
        setError(errorData.error || `Failed to ${archiving ? 'archive' : 'restore'} group`);
      }
    } catch (err: any) {
      setError(`Failed to ${archiving ? 'archive' : 'restore'} group`);
    }
  };

  const handleAddGroupMember = async (groupId: number, userId: number) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: userId })
      });

      if (response.ok) {
        setSuccess('Member added successfully!');
        loadGroupMembers(groupId); // Reload group members
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to add member');
      }
    } catch (err: any) {
      setError('Failed to add member');
    }
  };

  const handleRemoveGroupMember = async (groupId: number, userId: number) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch(`/api/admin/groups/${groupId}/members/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        setSuccess('Member removed successfully!');
        loadGroupMembers(groupId); // Reload group members
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to remove member');
      }
    } catch (err: any) {
      setError('Failed to remove member');
    }
  };

  const loadGroupMembers = async (groupId: number) => {
    try {
      const response = await fetch(`/api/admin/groups/${groupId}/members`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
      });

      if (response.ok) {
        const membersData = await response.json();
        setGroupMembers(membersData);
      }
    } catch (error) {
      console.error('Failed to load group members:', error);
    }
  };

  const handleCreateInviteLink = async (linkData: any) => {
    try {
      setError('');
      setSuccess('');

      const response = await fetch('/api/invite-links', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(linkData)
      });

      if (response.ok) {
        const result = await response.json();
        setSuccess(`Invite link created! URL: ${result.invite_url}`);
        setShowCreateInviteLink(false);
        loadData(); // Reload invite links
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create invite link');
      }
    } catch (err: any) {
      setError('Failed to create invite link');
    }
  };

  const handleToggleInviteLink = async (linkId: number, activate: boolean) => {
    try {
      setError('');
      setSuccess('');

      const endpoint = activate ? 'activate' : 'deactivate';
      const response = await fetch(`/api/invite-links/${linkId}/${endpoint}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        setSuccess(`Invite link ${activate ? 'activated' : 'deactivated'} successfully!`);
        loadData(); // Reload invite links
      } else {
        const errorData = await response.json();
        setError(errorData.error || `Failed to ${activate ? 'activate' : 'deactivate'} invite link`);
      }
    } catch (err: any) {
      setError(`Failed to ${activate ? 'activate' : 'deactivate'} invite link`);
    }
  };

  const handleDeleteInviteLink = async (linkId: number) => {
    if (!window.confirm('Are you sure you want to delete this invite link? This action cannot be undone.')) {
      return;
    }

    try {
      setError('');
      setSuccess('');

      const response = await fetch(`/api/invite-links/${linkId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        setSuccess('Invite link deleted successfully!');
        loadData(); // Reload invite links
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete invite link');
      }
    } catch (err: any) {
      setError('Failed to delete invite link');
    }
  };

  // Quicklinks management functions
  const createQuicklink = async (data: {
    title: string;
    url: string;
    description?: string;
    display_order?: number;
  }) => {
    try {
      setError('');
      await quicklinksApi.createQuicklink(data);
      setSuccess('Quicklink created successfully');
      setShowCreateQuicklink(false);
      loadData();
    } catch (error: any) {
      console.error('Create quicklink error:', error);
      setError(error.response?.data?.error || 'Failed to create quicklink');
    }
  };

  const updateQuicklink = async (id: number, data: {
    title: string;
    url: string;
    description?: string;
    display_order?: number;
    is_active?: boolean;
  }) => {
    try {
      setError('');
      await quicklinksApi.updateQuicklink(id, data);
      setSuccess('Quicklink updated successfully');
      setEditingQuicklink(null);
      loadData();
    } catch (error: any) {
      console.error('Update quicklink error:', error);
      setError(error.response?.data?.error || 'Failed to update quicklink');
    }
  };

  const deleteQuicklink = async (id: number) => {
    if (!confirm('Are you sure you want to delete this quicklink?')) return;
    
    try {
      setError('');
      await quicklinksApi.deleteQuicklink(id);
      setSuccess('Quicklink deleted successfully');
      loadData();
    } catch (error: any) {
      console.error('Delete quicklink error:', error);
      setError(error.response?.data?.error || 'Failed to delete quicklink');
    }
  };

  const requestAgreement = async (userId: number, userName: string) => {
    if (!confirm(`Request new agreement signature from ${userName}?\n\nThis will:\n• Set their role to 'pending_agreement'\n• Require them to sign the current agreement version\n• Block their platform access until signed`)) return;
    
    try {
      setError('');
      setSuccess('');
      setRequestingAgreement(userId);
      console.log('Requesting agreement for user:', userId, userName);
      
      const response = await usersApi.requestAgreement(userId);
      console.log('Request agreement response:', response);
      
      setSuccess(`✅ Agreement v${response.agreement_version} requested from ${response.user_name}. Email notification sent.`);
      
      // Reload users after a brief delay to show the success message
      setTimeout(() => {
        loadData();
      }, 1000);
      
    } catch (error: any) {
      console.error('Request agreement error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to request agreement';
      console.log('Error details:', error.response?.status, errorMessage);
      setError(`❌ ${errorMessage}`);
    } finally {
      setRequestingAgreement(null);
    }
  };

  const createCustomAgreement = async () => {
    if (!newAgreement.version.trim() || !newAgreement.title.trim() || !newAgreement.content.trim()) {
      setError('Version, title, and content are required');
      return;
    }
    if (newAgreement.agreement_type === 'team' && (!newAgreement.quiz_question.trim() || !newAgreement.quiz_correct_answer.trim())) {
      setError('Team agreements require a quiz question and answer');
      return;
    }
    if (newAgreement.agreement_type === 'team' &&
        !confirm('Creating a new TEAM agreement immediately replaces the currently active team agreement for all new signers. Continue?')) {
      return;
    }
    try {
      setCreatingAgreement(true);
      setError('');
      await agreementsApi.createAgreementVersion({
        version: newAgreement.version.trim(),
        title: newAgreement.title.trim(),
        content: newAgreement.content,
        agreement_type: newAgreement.agreement_type,
        quiz_question: newAgreement.quiz_question.trim() || undefined,
        quiz_correct_answer: newAgreement.quiz_correct_answer.trim() || undefined,
        required_fields: newAgreement.required_fields.length > 0 ? newAgreement.required_fields : undefined,
        confirmations: newAgreement.confirmations.length > 0 ? newAgreement.confirmations : undefined,
        assign_to_user_ids: newAgreement.assign_to_user_ids.length > 0 ? newAgreement.assign_to_user_ids : undefined,
      });
      setSuccess(`✅ Agreement "${newAgreement.title}" created${newAgreement.assign_to_user_ids.length > 0 ? ` and assigned to ${newAgreement.assign_to_user_ids.length} user(s)` : ''}.`);
      setShowCreateAgreement(false);
      setNewAgreement(emptyNewAgreement);
      loadData();
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to create agreement version');
    } finally {
      setCreatingAgreement(false);
    }
  };

  const loadVersionAssignments = async (version: any) => {
    try {
      if (assignmentsVersion?.id === version.id) {
        setAssignmentsVersion(null);
        setVersionAssignments([]);
        return;
      }
      const assignments = await agreementsApi.getVersionAssignments(version.id);
      setAssignmentsVersion(version);
      setVersionAssignments(assignments);
    } catch (error) {
      setError('Failed to load assignments');
    }
  };

  const assignUserToVersion = async () => {
    const userId = parseInt(assignPickerUserId);
    if (!assignmentsVersion || isNaN(userId)) return;
    try {
      await agreementsApi.assignVersionToUsers(assignmentsVersion.id, [userId]);
      setSuccess('✅ Agreement assigned. Email notification sent.');
      setAssignPickerUserId('');
      setVersionAssignments(await agreementsApi.getVersionAssignments(assignmentsVersion.id));
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to assign agreement');
    }
  };

  const cancelVersionAssignment = async (userId: number, userName: string) => {
    if (!assignmentsVersion) return;
    if (!confirm(`Cancel the pending agreement assignment for ${userName}?`)) return;
    try {
      await agreementsApi.cancelAssignment(assignmentsVersion.id, userId);
      setVersionAssignments(await agreementsApi.getVersionAssignments(assignmentsVersion.id));
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to cancel assignment');
    }
  };

  const loadAgreementDetails = async (version: any) => {
    try {
      // Clear any existing content viewer
      setShowAgreementContent(null);
      
      // If clicking the same version, just toggle off
      if (selectedAgreementVersion?.id === version.id) {
        setSelectedAgreementVersion(null);
        return;
      }
      
      setSelectedAgreementVersion(version);
      
      const response = await fetch(`/api/admin/agreements/versions/${version.id}/signatures`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}` }
      });
      
      if (response.ok) {
        const signatures = await response.json();
        console.log('Loaded signatures for version', version.version, ':', signatures);
        // Update the selectedAgreementVersion with its signatures
        setSelectedAgreementVersion({
          ...version,
          signatures: signatures
        });
      } else {
        console.error('Failed to load signatures:', await response.text());
        setError('Failed to load agreement signatures');
      }
    } catch (error) {
      console.error('Load agreement details error:', error);
      setError('Failed to load agreement details');
    }
  };

  const tabs = [
    { id: 'invites', label: 'Invitations', icon: UserPlus },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'emailrequests', label: 'Email Requests', icon: Mail },
    { id: 'company-emails', label: `${companyShortName} Emails`, icon: Mail },
    { id: 'deliverables', label: 'Investment Tracker', icon: DollarSign },
    { id: 'groups', label: 'Groups', icon: UserCheck },
    { id: 'quicklinks', label: 'Quick Links', icon: Link },
    { id: 'agreements', label: 'Agreements', icon: FileText },
    { id: 'search-adapters', label: 'Search Adapters', icon: Search },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Shield className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600">You need admin privileges to access this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
        <p className="mt-2 text-gray-600">
          Manage users, invitations, and platform settings
        </p>
      </div>

      {/* Global Messages */}
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

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setSearchParams({ tab: tab.id });
                }}
                className={`
                  flex items-center py-2 px-1 border-b-2 font-medium text-sm
                  ${activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <Icon className="h-5 w-5 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* Invitations Tab */}
        {activeTab === 'invites' && (
          <>
            {/* Create Invite Form */}
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Create New Invitation</h2>
              
              <form onSubmit={handleSubmit(onCreateInvite)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name *
                    </label>
                    <input
                      {...register('name')}
                      type="text"
                      className="form-input"
                      placeholder="Full name of invitee"
                    />
                    {errors.name && (
                      <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email (Optional)
                    </label>
                    <input
                      {...register('email')}
                      type="email"
                      className="form-input"
                      placeholder="user@example.com"
                    />
                    {errors.email && (
                      <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      If specified, only this email can use the invite
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Expires in (days)
                    </label>
                    <input
                      {...register('expires_days', { valueAsNumber: true })}
                      type="number"
                      min="1"
                      max="30"
                      className="form-input"
                    />
                    {errors.expires_days && (
                      <p className="mt-1 text-sm text-red-600">{errors.expires_days.message}</p>
                    )}
                  </div>
                </div>

                <button type="submit" className="btn btn-primary">
                  Generate Invitation
                </button>
              </form>
            </div>

            {/* Invitations List */}
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Invitation Codes</h2>
              
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-20 bg-gray-300 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : invites.length > 0 ? (
                <div className="space-y-4">
                  {invites.map((invite) => (
                    <div key={invite.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="font-medium text-gray-900">
                              {invite.name || 'General Invite'}
                            </h3>
                            <span className={`
                              px-2 py-1 rounded-full text-xs font-medium
                              ${invite.used_at 
                                ? 'bg-gray-100 text-gray-800' 
                                : new Date(invite.expires_at) < new Date()
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-green-100 text-green-800'
                              }
                            `}>
                              {invite.used_at 
                                ? 'Used' 
                                : new Date(invite.expires_at) < new Date()
                                  ? 'Expired'
                                  : 'Active'
                              }
                            </span>
                          </div>
                          
                          <div className="text-sm text-gray-600 space-y-1">
                            {invite.email && (
                              <p><strong>Email:</strong> {invite.email}</p>
                            )}
                            <p><strong>Created by:</strong> {invite.created_by_name}</p>
                            <p><strong>Expires:</strong> {new Date(invite.expires_at).toLocaleDateString()}</p>
                            {invite.used_at && (
                              <p><strong>Used:</strong> {formatTimeAgo(invite.used_at)} by {invite.used_by_name}</p>
                            )}
                          </div>

                          {!invite.used_at && new Date(invite.expires_at) > new Date() && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-xs text-gray-600 mb-1">Invite URL:</p>
                                  <code className="text-sm text-gray-800 bg-white px-2 py-1 rounded border">
                                    {window.location.origin}/register?invite={invite.code}
                                  </code>
                                </div>
                                <div className="flex items-center space-x-2 ml-3">
                                  <button
                                    onClick={() => copyToClipboard(
                                      `${window.location.origin}/register?invite=${invite.code}`,
                                      invite.code
                                    )}
                                    className="p-2 text-gray-500 hover:text-gray-700"
                                    title="Copy invite URL"
                                  >
                                    {copiedCode === invite.code ? (
                                      <Check className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <Copy className="h-4 w-4" />
                                    )}
                                  </button>
                                  
                                  {invite.email && (
                                    <button
                                      onClick={() => {
                                        if (window.confirm('Resend is currently unavailable. Would you like to delete this invitation and create a fresh one instead? This will send a new email with a new invitation link.')) {
                                          deleteInvite(invite.id);
                                        }
                                      }}
                                      className="px-3 py-1 text-sm bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded-md"
                                      title="Delete and recreate invitation (sends fresh email)"
                                    >
                                      Recreate
                                    </button>
                                  )}
                                  
                                  <button
                                    onClick={() => deleteInvite(invite.id)}
                                    className="p-2 text-red-500 hover:text-red-700"
                                    title="Delete invitation"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <UserPlus className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No invitations created yet</p>
                </div>
              )}
            </div>

            {/* Invite Links Section */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Invitation Links</h2>
                <button
                  onClick={() => setShowCreateInviteLink(true)}
                  className="btn btn-primary"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Generate Link
                </button>
              </div>

              {/* Create Invite Link Form */}
              {showCreateInviteLink && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-blue-900">Create Invitation Link</h3>
                    <button
                      onClick={() => setShowCreateInviteLink(false)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ✕
                    </button>
                  </div>
                  
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target as HTMLFormElement);
                    
                    const linkData = {
                      name: formData.get('name'),
                      description: formData.get('description'),
                      max_uses: formData.get('max_uses') ? parseInt(formData.get('max_uses') as string) : undefined,
                      days_valid: parseInt(formData.get('days_valid') as string) || 7
                    };
                    
                    handleCreateInviteLink(linkData);
                  }} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Link Name *
                        </label>
                        <input
                          name="name"
                          type="text"
                          className="form-input"
                          placeholder="e.g., General Registration Link"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Valid for (days)
                        </label>
                        <input
                          name="days_valid"
                          type="number"
                          min="1"
                          max="30"
                          defaultValue="7"
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description (Optional)
                      </label>
                      <textarea
                        name="description"
                        className="form-textarea"
                        rows={2}
                        placeholder="Optional description for this invite link"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Uses (Optional)
                      </label>
                      <input
                        name="max_uses"
                        type="number"
                        min="1"
                        className="form-input"
                        placeholder="Leave blank for unlimited uses"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Leave blank for unlimited registrations
                      </p>
                    </div>

                    <button type="submit" className="btn btn-primary">
                      Create Invite Link
                    </button>
                  </form>
                </div>
              )}

              {/* Invite Links List */}
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-gray-300 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : inviteLinks.length > 0 ? (
                <div className="space-y-4">
                  {inviteLinks.map((link) => (
                    <div key={link.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="font-medium text-gray-900">
                              {link.name}
                            </h3>
                            <span className={`
                              px-2 py-1 rounded-full text-xs font-medium
                              ${link.is_active && new Date(link.expires_at) > new Date()
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                              }
                            `}>
                              {link.is_active && new Date(link.expires_at) > new Date() ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          
                          {link.description && (
                            <p className="text-sm text-gray-600 mb-2">{link.description}</p>
                          )}
                          
                          <div className="text-sm text-gray-500 space-y-1">
                            <p><strong>Uses:</strong> {link.total_uses}{link.max_uses ? ` / ${link.max_uses}` : ' (unlimited)'}</p>
                            <p><strong>Expires:</strong> {new Date(link.expires_at).toLocaleDateString()}</p>
                            <p><strong>Created by:</strong> {link.created_by_name}</p>
                          </div>

                          {link.is_active && new Date(link.expires_at) > new Date() && (
                            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-xs text-gray-600 mb-1">Invite URL:</p>
                                  <code className="text-sm text-gray-800 bg-white px-2 py-1 rounded border break-all">
                                    {window.location.origin}/register?link={link.link_code}
                                  </code>
                                </div>
                                <button
                                  onClick={() => copyToClipboard(
                                    `${window.location.origin}/register?link=${link.link_code}`,
                                    link.link_code
                                  )}
                                  className="p-2 text-gray-500 hover:text-gray-700 ml-3"
                                  title="Copy invite URL"
                                >
                                  {copiedCode === link.link_code ? (
                                    <Check className="h-4 w-4 text-green-500" />
                                  ) : (
                                    <Copy className="h-4 w-4" />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex space-x-2 ml-4">
                          <button
                            onClick={() => handleToggleInviteLink(link.id, !link.is_active)}
                            className={`btn btn-sm ${
                              link.is_active ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {link.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          
                          <button
                            onClick={() => handleDeleteInviteLink(link.id)}
                            className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                            title="Delete invite link"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <UserPlus className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No invitation links created yet</p>
                  <button
                    onClick={() => setShowCreateInviteLink(true)}
                    className="mt-2 btn btn-primary"
                  >
                    Create Your First Link
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">User Management</h2>
            
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-16 bg-gray-300 rounded"></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {users.map((userData) => (
                  <div key={userData.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0">
                          {userData.avatar_url ? (
                            <img
                              src={userData.avatar_url}
                              alt={`${userData.name} profile`}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-primary-500 flex items-center justify-center">
                              <span className="text-sm font-medium text-white">
                                {userData.name?.charAt(0)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">{userData.name}</h3>
                          <p className="text-sm text-gray-600">{userData.email}</p>
                          {(userData.intranet_username || userData.github_username) && (
                            <p className="text-xs text-gray-500">@{userData.intranet_username || userData.github_username}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <span className={`
                          px-3 py-1 rounded-full text-xs font-medium
                          ${userData.role === 'admin' ? 'bg-red-100 text-red-800' :
                            userData.role === 'moderator' ? 'bg-purple-100 text-purple-800' :
                            userData.role === 'user' ? 'bg-green-100 text-green-800' :
                            userData.role === 'deactivated' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'}
                        `}>
                          {userData.role?.charAt(0).toUpperCase() + userData.role?.slice(1)}
                        </span>
                        
                        <select
                          value={userData.role}
                          onChange={(e) => updateUserRole(userData.id, e.target.value)}
                          className="text-sm border border-gray-300 rounded px-2 py-1"
                          disabled={userData.id === user?.id} // Can't change own role
                        >
                          <option value="pending">Pending</option>
                          <option value="user">User</option>
                          <option value="moderator">Moderator</option>
                          <option value="admin">Admin</option>
                          <option value="deactivated">Deactivated</option>
                        </select>
                        
                        {/* Request Agreement Button */}
                        {userData.id !== user?.id && userData.role !== 'pending_agreement' && (
                          <button
                            onClick={() => requestAgreement(userData.id, userData.name)}
                            disabled={requestingAgreement === userData.id}
                            className={`ml-2 px-3 py-1 rounded text-sm transition-colors ${
                              requestingAgreement === userData.id
                                ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }`}
                            title="Request agreement signature from user"
                          >
                            {requestingAgreement === userData.id ? '⏳ Sending...' : '📄 Request Agreement'}
                          </button>
                        )}
                        
                        {/* Delete User Button */}
                        {userData.id !== user?.id && userData.role !== 'admin' && (
                          <button
                            onClick={() => handleDeleteUser(userData.id)}
                            className="ml-2 px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-sm"
                            title="Delete user account"
                          >
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Hourly Rate Field */}
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center space-x-3">
                        <label className="text-sm font-medium text-gray-700 w-32">
                          Hourly Rate ({baseCurrency}):
                        </label>
                        <div className="relative flex-1 max-w-xs">
                          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editingHourlyRates[userData.id] ?? (userData.hourly_rate || '')}
                            onChange={(e) => {
                              setEditingHourlyRates(prev => ({
                                ...prev,
                                [userData.id]: e.target.value
                              }));
                            }}
                            onBlur={(e) => {
                              const value = e.target.value ? parseFloat(e.target.value) : null;
                              updateUserHourlyRate(userData.id, value);
                              setEditingHourlyRates(prev => {
                                const newState = { ...prev };
                                delete newState[userData.id];
                                return newState;
                              });
                            }}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              }
                            }}
                            placeholder="Not set"
                            className="pl-7 pr-3 py-1 border border-gray-300 rounded text-sm w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {userData.hourly_rate && userData.hourly_rate >= 100 ? (
                            <span className="text-green-600 font-medium">✓ Can view all investments</span>
                          ) : (
                            <span className="text-gray-400">Set ≥$100 to view all</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Email Requests Tab */}
        {activeTab === 'emailrequests' && (
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Email Requests</h2>
            
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-24 bg-gray-300 rounded"></div>
                  </div>
                ))}
              </div>
            ) : emailRequests.length > 0 ? (
              <div className="space-y-4">
                {emailRequests.map((request) => (
                  <div key={request.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <h3 className="font-medium text-gray-900">
                            {request.requested_email}
                          </h3>
                          <span className={`
                            px-2 py-1 rounded-full text-xs font-medium
                            ${request.status === 'approved' ? 'bg-green-100 text-green-800' :
                              request.status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'}
                          `}>
                            {request.status?.charAt(0).toUpperCase() + request.status?.slice(1)}
                          </span>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2">
                          <strong>Requested by:</strong> {request.requester_name} ({request.requester_email})
                        </p>
                        
                        <p className="text-sm text-gray-700 mb-2">
                          <strong>Justification:</strong> {request.justification}
                        </p>
                        
                        <p className="text-xs text-gray-500">
                          Submitted {formatTimeAgo(request.created_at)}
                        </p>
                        
                        {request.rejection_reason && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                            <p className="text-sm text-red-700">
                              <strong>Rejection Reason:</strong> {request.rejection_reason}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {request.status === 'pending' && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => approveEmailRequest(request.id, 'approved')}
                            className="btn btn-sm bg-green-600 text-white hover:bg-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt('Rejection reason (optional):');
                              approveEmailRequest(request.id, 'rejected', reason || undefined);
                            }}
                            className="btn btn-sm bg-red-600 text-white hover:bg-red-700"
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Mail className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No email requests</p>
              </div>
            )}
          </div>
        )}

        {/* Company Emails Tab */}
        {activeTab === 'company-emails' && (
          <div className="space-y-6">
            {/* Server Status */}
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Mail Server Status</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    serverStatus.postfix === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {serverStatus.postfix === 'active' ? '✅' : '❌'} Postfix
                  </div>
                </div>
                <div className="text-center">
                  <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    serverStatus.dovecot === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {serverStatus.dovecot === 'active' ? '✅' : '❌'} Dovecot
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-gray-900">{serverStatus.total_accounts || 0}</div>
                  <div className="text-xs text-gray-500">Total Accounts</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-gray-900">{serverStatus.active_accounts || 0}</div>
                  <div className="text-xs text-gray-500">Active</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-gray-900">{serverStatus.disk_usage || 'Unknown'}</div>
                  <div className="text-xs text-gray-500">Disk Usage</div>
                </div>
              </div>
            </div>

            {/* Create New Email Account */}
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Create New @{companyEmailDomain} Email</h2>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="font-medium text-blue-900 mb-4 flex items-center">
                  <Mail className="h-5 w-5 mr-2" />
                  User-Chosen Email Creation
                </h3>
                <p className="text-sm text-blue-800 mb-4">
                  {`Create a custom @${companyEmailDomain} email address. User chooses their own username.`}
                </p>
                
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  const userId = parseInt(formData.get('user_id') as string);
                  const username = formData.get('username') as string;
                  const password = formData.get('password') as string;
                  
                  if (userId && username && password) {
                    handleCreateEmailAccount(userId, username, password);
                    (e.target as HTMLFormElement).reset();
                  }
                }} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Select User</label>
                      <select name="user_id" className="form-select w-full" required>
                        <option value="">Choose a user...</option>
                        {users.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name}{(user.intranet_username || user.github_username) && ` (@${user.intranet_username || user.github_username})`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                      <div className="flex">
                        <input
                          name="username"
                          type="text"
                          className="form-input rounded-r-none"
                          placeholder="username"
                          pattern="[a-zA-Z0-9._\-]+"
                          required
                        />
                        <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                          @{companyEmailDomain}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                      <input
                        name="password"
                        type="password"
                        className="form-input w-full"
                        placeholder="Strong password"
                        minLength={8}
                        required
                      />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-primary">
                    Create Email Account
                  </button>
                </form>
              </div>
            </div>

            {/* All Server Email Accounts */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">All @{companyEmailDomain} Email Accounts</h2>
                <button
                  onClick={() => loadData()}
                  className="btn btn-sm btn-secondary"
                >
                  🔄 Refresh
                </button>
              </div>
              
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-16 bg-gray-300 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email Address</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Linked User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Disk Usage</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {serverAccounts.map((account) => (
                        <tr key={account.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{account.email_address}</div>
                            <div className="text-sm text-gray-500">{account.server_username}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {account.linked_user_name ? (
                              <div>
                                <div className="text-sm font-medium text-gray-900">{account.linked_user_name}</div>
                                <div className="text-sm text-gray-500">{account.linked_user_email}</div>
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  account.linked_user_role === 'admin' ? 'bg-red-100 text-red-800' :
                                  account.linked_user_role === 'moderator' ? 'bg-purple-100 text-purple-800' :
                                  'bg-green-100 text-green-800'
                                }`}>
                                  {account.linked_user_role}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center">
                                <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                                  [Orphaned]
                                </span>
                                <select
                                  className="ml-2 text-xs border border-gray-300 rounded px-2 py-1"
                                  onChange={(e) => {
                                    const userId = parseInt(e.target.value);
                                    if (userId) {
                                      handleLinkOrphanedAccount(account.id, userId);
                                    }
                                  }}
                                  defaultValue=""
                                >
                                  <option value="">Link to user...</option>
                                  {users.map(user => (
                                    <option key={user.id} value={user.id}>
                                      {user.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              account.server_status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {account.server_status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {account.disk_usage_mb ? `${account.disk_usage_mb} MB` : 'Unknown'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {account.last_login ? formatTimeAgo(account.last_login) : 'Never'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex space-x-2">
                              <button
                                onClick={() => {
                                  // Reset password functionality
                                  const newPassword = prompt('Enter new password (min 8 characters):');
                                  if (newPassword && newPassword.length >= 8) {
                                    // Call reset password API
                                    console.log('Reset password for', account.email_address);
                                  }
                                }}
                                className="text-indigo-600 hover:text-indigo-900"
                                title="Reset password"
                              >
                                🔑 Reset
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm(`Delete email account ${account.email_address}?\n\nThis will deactivate the account but preserve emails.`)) {
                                    try {
                                      setError('');
                                      setSuccess('');
                                      
                                      // Use different endpoint based on whether account is linked or orphaned
                                      const isOrphaned = !account.linked_user_id || account.linked_user_name === '[Orphaned]';
                                      const endpoint = isOrphaned 
                                        ? '/api/admin/company-email/delete-orphaned'
                                        : '/api/admin/company-email/delete';
                                      
                                      const body = isOrphaned 
                                        ? { email_address: account.email_address }
                                        : { user_id: account.linked_user_id };
                                      
                                      const response = await fetch(endpoint, {
                                        method: 'DELETE',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify(body)
                                      });

                                      if (response.ok) {
                                        await response.json();
                                        setSuccess(`Email account ${account.email_address} deleted successfully!`);
                                        loadData(); // Reload server accounts
                                      } else if (response.status === 401 || response.status === 403) {
                                        setError('Authentication expired. Please refresh the page and try again.');
                                      } else {
                                        const errorData = await response.json();
                                        setError(errorData.error || 'Failed to delete email account');
                                      }
                                    } catch (err: any) {
                                      setError('Failed to delete email account');
                                    }
                                  }
                                }}
                                className="text-red-600 hover:text-red-900"
                                title="Delete account"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {serverAccounts.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      No email accounts found
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Groups Tab */}
        {activeTab === 'groups' && (
          <div className="space-y-6">
            {/* Create Group Form */}
            {showCreateGroup && (
              <div className="card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">Create New Group</h2>
                  <button
                    onClick={() => setShowCreateGroup(false)}
                    className="btn btn-sm btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
                
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  const selectedMembers = Array.from(formData.getAll('members')).map(Number);
                  
                  const groupData = {
                    name: formData.get('name'),
                    display_name: formData.get('display_name'),
                    description: formData.get('description'),
                    email_alias: formData.get('email_alias'),
                    members: selectedMembers
                  };
                  
                  handleCreateGroup(groupData);
                }} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Group Name (ID) *
                      </label>
                      <input
                        name="name"
                        type="text"
                        className="form-input"
                        placeholder="sales, support, engineering"
                        pattern="[a-zA-Z0-9_\-]+"
                        required
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Lowercase, alphanumeric, dashes and underscores only
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Display Name *
                      </label>
                      <input
                        name="display_name"
                        type="text"
                        className="form-input"
                        placeholder="Sales Team"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Alias (Optional)
                    </label>
                    <input
                      name="email_alias"
                      type="email"
                      className="form-input"
                      placeholder={`sales@${companyEmailDomain}`}
                      pattern={`[a-zA-Z0-9._\\-]+@${companyEmailDomain.replace('.', '\\.')}`}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Creates an email alias that forwards to all group members
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      name="description"
                      className="form-textarea"
                      rows={3}
                      placeholder="Group purpose and responsibilities"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Initial Members
                    </label>
                    <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-3 space-y-2">
                      {users.map(userData => (
                        <label key={userData.id} className="flex items-center">
                          <input
                            type="checkbox"
                            name="members"
                            value={userData.id}
                            className="rounded border-gray-300 text-primary-600 mr-2"
                          />
                          <div className="flex items-center space-x-2">
                            {userData.avatar_url ? (
                              <img
                                src={userData.avatar_url}
                                alt={userData.name}
                                className="h-5 w-5 rounded-full"
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-primary-500 flex items-center justify-center">
                                <span className="text-xs text-white">
                                  {userData.name?.charAt(0)}
                                </span>
                              </div>
                            )}
                            <span className="text-sm">{userData.name}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button type="submit" className="btn btn-primary">
                    Create Group
                  </button>
                </form>
              </div>
            )}

            {/* Groups List */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Groups</h2>
                <div className="flex items-center space-x-4">
                  <label className="flex items-center text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mr-2"
                      checked={showArchivedGroups}
                      onChange={(e) => setShowArchivedGroups(e.target.checked)}
                    />
                    Show archived ({groups.filter(g => !g.is_active).length})
                  </label>
                  <button
                    onClick={() => setShowCreateGroup(true)}
                    className="btn btn-primary"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create Group
                  </button>
                </div>
              </div>
              
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-20 bg-gray-300 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : groups.filter(g => showArchivedGroups || g.is_active).length > 0 ? (
                <div className="space-y-4">
                  {groups.filter(g => showArchivedGroups || g.is_active).map((group) => (
                    <div key={group.id} className={`border border-gray-200 rounded-lg p-4 ${group.is_active ? '' : 'bg-gray-50 opacity-75'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className="font-medium text-gray-900">
                              {group.display_name}
                            </h3>
                            <span className="text-sm text-gray-500">
                              (@{group.name})
                            </span>
                            {group.email_alias && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                📧 {group.email_alias}
                              </span>
                            )}
                            {!group.is_active && (
                              <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded-full">
                                Archived
                              </span>
                            )}
                          </div>
                          
                          {group.description && (
                            <p className="text-sm text-gray-600 mb-2">{group.description}</p>
                          )}
                          
                          <div className="text-sm text-gray-500 space-y-1">
                            <p><strong>Members:</strong> {group.member_count}</p>
                            <p><strong>Created by:</strong> {group.created_by_name}</p>
                            <p><strong>Created:</strong> {new Date(group.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        
                        <div className="flex space-x-2">
                          <button
                            onClick={() => {
                              setSelectedGroup(group);
                              loadGroupMembers(group.id);
                            }}
                            className="btn btn-sm btn-secondary"
                          >
                            Manage Members
                          </button>
                          <button
                            onClick={() => handleToggleGroupArchived(group)}
                            className="btn btn-sm btn-secondary"
                            title={group.is_active
                              ? 'Hide this group from Group Chat. Members, messages and the email alias are kept.'
                              : 'Make this group visible in Group Chat again.'}
                          >
                            {group.is_active ? 'Archive' : 'Restore'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <UserCheck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No groups created yet</p>
                  <button
                    onClick={() => setShowCreateGroup(true)}
                    className="mt-2 btn btn-primary"
                  >
                    Create Your First Group
                  </button>
                </div>
              )}
            </div>

            {/* Group Members Management Modal */}
            {selectedGroup && (
              <div 
                className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                onClick={() => {
                  setSelectedGroup(null);
                  setGroupMembers([]);
                }}
              >
                <div 
                  className="bg-white rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-y-auto w-full mx-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900">
                      Manage Members: {selectedGroup.display_name}
                    </h2>
                    <button
                      onClick={() => {
                        setSelectedGroup(null);
                        setGroupMembers([]);
                      }}
                      className="btn btn-sm btn-secondary"
                    >
                      ✕ Close
                    </button>
                  </div>

                {/* Add Member */}
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="font-medium text-gray-900 mb-2">Add Member</h3>
                  <select
                    onChange={(e) => {
                      const userId = parseInt(e.target.value);
                      if (userId) {
                        handleAddGroupMember(selectedGroup.id, userId);
                        e.target.value = '';
                      }
                    }}
                    className="form-select"
                  >
                    <option value="">Select a user to add...</option>
                    {users
                      .filter(userData => !groupMembers.some(member => member.user_id === userData.id))
                      .map(userData => (
                        <option key={userData.id} value={userData.id}>
                          {userData.name} ({userData.email})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Current Members */}
                <div>
                  <h3 className="font-medium text-gray-900 mb-4">Current Members ({groupMembers.length})</h3>
                  {groupMembers.length > 0 ? (
                    <div className="space-y-3">
                      {groupMembers.map((member) => (
                        <div key={member.user_id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                          <div className="flex items-center space-x-3">
                            {member.avatar_url ? (
                              <img
                                src={member.avatar_url}
                                alt={member.name}
                                className="h-8 w-8 rounded-full"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-primary-500 flex items-center justify-center">
                                <span className="text-sm text-white">
                                  {member.name?.charAt(0)}
                                </span>
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-gray-900">{member.name}</p>
                              <p className="text-sm text-gray-500">{member.email}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                              {member.role}
                            </span>
                            <button
                              onClick={() => handleRemoveGroupMember(selectedGroup.id, member.user_id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">No members in this group yet</p>
                  )}
                </div>
              </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'quicklinks' && (
          <div className="space-y-6">
            {/* Header and Add Button */}
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Quick Links Management</h2>
                <p className="text-sm text-gray-600 mt-1">Manage the quick links displayed on the dashboard</p>
              </div>
              <button
                onClick={() => setShowCreateQuicklink(true)}
                className="btn btn-primary"
              >
                Add Quick Link
              </button>
            </div>

            {/* Create/Edit Form Modal */}
            {(showCreateQuicklink || editingQuicklink) && (
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {editingQuicklink ? 'Edit Quick Link' : 'Create Quick Link'}
                </h3>
                <QuicklinkForm
                  quicklink={editingQuicklink}
                  onSubmit={(data) => editingQuicklink ? updateQuicklink(editingQuicklink.id, data) : createQuicklink(data)}
                  onCancel={() => {
                    setShowCreateQuicklink(false);
                    setEditingQuicklink(null);
                  }}
                />
              </div>
            )}

            {/* Quicklinks List */}
            <div className="card">
              {isLoading ? (
                <div className="p-6 text-center text-gray-500">Loading quicklinks...</div>
              ) : quicklinks.length > 0 ? (
                <div className="divide-y divide-gray-200">
                  {quicklinks.map((quicklink) => (
                    <div key={quicklink.id} className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center">
                            <h3 className="text-lg font-medium text-gray-900">{quicklink.title}</h3>
                            <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              quicklink.is_active 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {quicklink.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{quicklink.description}</p>
                          <a 
                            href={quicklink.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:text-blue-800 mt-1 inline-block"
                          >
                            {quicklink.url}
                          </a>
                          <p className="text-xs text-gray-500 mt-2">Order: {quicklink.display_order}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => setEditingQuicklink(quicklink)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteQuicklink(quicklink.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-500">
                  <Link className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No quicklinks yet. Create your first one!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'agreements' && (
          <div className="space-y-6">
            {/* Agreement Versions Overview */}
            <div className="card p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Agreement Management</h2>
                  <p className="text-gray-600">Manage agreement versions and track signatures</p>
                </div>
                <button
                  onClick={() => setShowCreateAgreement(!showCreateAgreement)}
                  className="btn btn-primary"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {showCreateAgreement ? 'Close' : 'New Agreement'}
                </button>
              </div>

              {/* Create agreement form */}
              {showCreateAgreement && (
                <div className="mb-6 border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Version *</label>
                      <input type="text" value={newAgreement.version}
                        onChange={(e) => setNewAgreement({ ...newAgreement, version: e.target.value })}
                        placeholder="e.g. EMP-JS-1.0"
                        className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                      <select value={newAgreement.agreement_type}
                        onChange={(e) => setNewAgreement({ ...newAgreement, agreement_type: e.target.value as any })}
                        className="w-full p-2 border border-gray-300 rounded">
                        <option value="custom">Custom (assigned to specific users)</option>
                        <option value="employment">Employment (assigned to specific users)</option>
                        <option value="team">Team (replaces the active team agreement!)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                      <input type="text" value={newAgreement.title}
                        onChange={(e) => setNewAgreement({ ...newAgreement, title: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Content (HTML) *</label>
                    <textarea value={newAgreement.content}
                      onChange={(e) => setNewAgreement({ ...newAgreement, content: e.target.value })}
                      rows={10}
                      placeholder="<h2>Agreement title</h2><p>Terms…</p>"
                      className="w-full p-2 border border-gray-300 rounded font-mono text-xs" />
                  </div>

                  {newAgreement.agreement_type === 'team' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quiz question *</label>
                        <input type="text" value={newAgreement.quiz_question}
                          onChange={(e) => setNewAgreement({ ...newAgreement, quiz_question: e.target.value })}
                          className="w-full p-2 border border-gray-300 rounded" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quiz correct answer *</label>
                        <input type="text" value={newAgreement.quiz_correct_answer}
                          onChange={(e) => setNewAgreement({ ...newAgreement, quiz_correct_answer: e.target.value })}
                          className="w-full p-2 border border-gray-300 rounded" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payroll fields to collect at signing</label>
                    <div className="flex flex-wrap gap-4">
                      {[
                        { key: 'sin', label: 'SIN' },
                        { key: 'direct_deposit', label: 'Direct deposit (bank details)' },
                        { key: 'address', label: 'Home address' },
                        { key: 'date_of_birth', label: 'Date of birth' },
                      ].map(f => (
                        <label key={f.key} className="flex items-center text-sm text-gray-700">
                          <input type="checkbox"
                            checked={newAgreement.required_fields.includes(f.key)}
                            onChange={(e) => setNewAgreement({
                              ...newAgreement,
                              required_fields: e.target.checked
                                ? [...newAgreement.required_fields, f.key]
                                : newAgreement.required_fields.filter(k => k !== f.key)
                            })}
                            className="mr-2 h-4 w-4 text-blue-600 border-gray-300 rounded" />
                          {f.label}
                        </label>
                      ))}
                    </div>
                    {newAgreement.required_fields.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">Collected values are encrypted at rest; the signer cannot sign without providing valid values.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirmation checkboxes</label>
                    {newAgreement.confirmations.map((c, i) => (
                      <div key={c.key} className="flex items-center gap-2 mb-1">
                        <span className="flex-1 text-sm text-gray-700">☑ {c.label}</span>
                        <button type="button"
                          onClick={() => setNewAgreement({ ...newAgreement, confirmations: newAgreement.confirmations.filter((_, j) => j !== i) })}
                          className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                      </div>
                    ))}
                    <div className="flex gap-2 mt-1">
                      <input type="text" value={newConfirmationLabel}
                        onChange={(e) => setNewConfirmationLabel(e.target.value)}
                        placeholder="e.g. I have read the full agreement"
                        className="flex-1 p-2 border border-gray-300 rounded text-sm" />
                      <button type="button"
                        onClick={() => {
                          const label = newConfirmationLabel.trim();
                          if (!label) return;
                          const key = `c${newAgreement.confirmations.length + 1}_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)}`;
                          setNewAgreement({ ...newAgreement, confirmations: [...newAgreement.confirmations, { key, label }] });
                          setNewConfirmationLabel('');
                        }}
                        className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700">Add</button>
                    </div>
                  </div>

                  {newAgreement.agreement_type !== 'team' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Assign to users (emails sent on create)</label>
                      <div className="flex flex-wrap gap-2">
                        {users.filter(u => u.role !== 'deactivated').map(u => (
                          <label key={u.id} className="flex items-center text-sm text-gray-700 border border-gray-200 bg-white rounded px-2 py-1">
                            <input type="checkbox"
                              checked={newAgreement.assign_to_user_ids.includes(u.id)}
                              onChange={(e) => setNewAgreement({
                                ...newAgreement,
                                assign_to_user_ids: e.target.checked
                                  ? [...newAgreement.assign_to_user_ids, u.id]
                                  : newAgreement.assign_to_user_ids.filter(id => id !== u.id)
                              })}
                              className="mr-2 h-4 w-4 text-blue-600 border-gray-300 rounded" />
                            {u.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button onClick={createCustomAgreement} disabled={creatingAgreement}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                      {creatingAgreement ? 'Creating…' : 'Create Agreement'}
                    </button>
                  </div>
                </div>
              )}

              {/* Agreement Versions List */}
              <div className="space-y-4">
                {agreementVersions.map((version) => (
                  <div key={version.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-lg font-medium text-gray-900">
                            {version.title} v{version.version}
                          </h3>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            version.agreement_type === 'employment' ? 'bg-purple-100 text-purple-700'
                            : version.agreement_type === 'custom' ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-700'
                          }`}>
                            {version.agreement_type || 'team'}
                          </span>
                          {version.is_active && (
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          Created {new Date(version.created_at).toLocaleDateString()}
                        </p>
                        <div className="flex items-center space-x-4 mt-2 text-sm">
                          <span className="text-gray-600">
                            <span className="font-medium text-green-600">{version.signed_count || 0}</span> signed
                          </span>
                          <span className="text-gray-600">
                            <span className="font-medium text-red-600">{version.voided_count || 0}</span> voided
                          </span>
                          <span className="text-gray-600">
                            <span className="font-medium text-blue-600">{version.signature_count || 0}</span> total
                          </span>
                          {version.agreement_type && version.agreement_type !== 'team' && (
                            <span className="text-gray-600">
                              <span className="font-medium text-amber-600">{version.pending_assignments || 0}</span> assigned pending
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setShowAgreementContent(version)}
                          className="text-purple-600 hover:text-purple-800 text-sm font-medium"
                        >
                          View Agreement Text
                        </button>
                        <button
                          onClick={() => loadAgreementDetails(version)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View Signatures ({version.signed_count || 0})
                        </button>
                        {version.agreement_type && version.agreement_type !== 'team' && (
                          <button
                            onClick={() => loadVersionAssignments(version)}
                            className="text-amber-600 hover:text-amber-800 text-sm font-medium"
                          >
                            Assignments
                          </button>
                        )}
                        <button
                          onClick={() => {/* TODO: Toggle active status */}}
                          className={`px-3 py-1 text-xs font-medium rounded ${
                            version.is_active 
                              ? 'bg-red-100 text-red-800 hover:bg-red-200'
                              : 'bg-green-100 text-green-800 hover:bg-green-200'
                          }`}
                        >
                          {version.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {agreementVersions.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>No agreement versions found.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Per-version assignment status */}
            {assignmentsVersion && (
              <div className="card p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {assignmentsVersion.title} v{assignmentsVersion.version} — Assignments
                  </h3>
                  <button
                    onClick={() => { setAssignmentsVersion(null); setVersionAssignments([]); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <select
                    value={assignPickerUserId}
                    onChange={(e) => setAssignPickerUserId(e.target.value)}
                    className="p-2 border border-gray-300 rounded text-sm"
                  >
                    <option value="">Assign to user…</option>
                    {users
                      .filter(u => u.role !== 'deactivated' && !versionAssignments.some(a => a.user_id === u.id && a.status !== 'cancelled'))
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                      ))}
                  </select>
                  <button
                    onClick={assignUserToVersion}
                    disabled={!assignPickerUserId}
                    className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Assign &amp; email
                  </button>
                </div>

                <div className="space-y-2">
                  {versionAssignments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{a.user_name}</p>
                        <p className="text-xs text-gray-500">{a.user_email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {!!a.payroll_on_file && (
                          <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                            payroll details on file
                          </span>
                        )}
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          a.status === 'signed' ? 'bg-green-100 text-green-800'
                          : a.status === 'pending' ? 'bg-amber-100 text-amber-800'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {a.status}{a.signed_at ? ` ${new Date(a.signed_at).toLocaleDateString()}` : ''}
                        </span>
                        {a.status === 'pending' && (
                          <button
                            onClick={() => cancelVersionAssignment(a.user_id, a.user_name)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {versionAssignments.length === 0 && (
                    <p className="text-sm text-gray-500">No assignments yet.</p>
                  )}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Agreement Activity</h3>
              <div className="space-y-3">
                {agreementSignatures.slice(0, 10).map((signature) => (
                  <div key={signature.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                    <img
                      src={signature.user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(signature.user_name)}&background=random`}
                      alt={signature.user_name}
                      className="w-8 h-8 rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{signature.user_name}</span> signed agreement v{signature.agreement_version}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(signature.signed_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      signature.status === 'signed' 
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {signature.status}
                    </span>
                  </div>
                ))}

                {agreementSignatures.length === 0 && (
                  <div className="text-center py-4 text-gray-500">
                    <p>No recent activity.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Selected Agreement Details Modal/Panel */}
            {selectedAgreementVersion && (
              <div className="card p-6 border-4 border-blue-500">
                <div className="bg-blue-50 p-2 mb-4 rounded">
                  <p className="text-xs">DEBUG: Details panel is showing for version {selectedAgreementVersion.version}</p>
                  <p className="text-xs">Signatures count: {selectedAgreementVersion.signatures?.length || 0}</p>
                </div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {selectedAgreementVersion.title} v{selectedAgreementVersion.version} - Signatures
                  </h3>
                  <button
                    onClick={() => setSelectedAgreementVersion(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
                
                <div className="space-y-3">
                  {(selectedAgreementVersion.signatures || []).map((signature: any) => (
                    <div key={signature.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <img
                          src={signature.user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(signature.user_name)}&background=random`}
                          alt={signature.user_name}
                          className="w-8 h-8 rounded-full"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{signature.user_name}</p>
                          <p className="text-xs text-gray-500">{signature.user_email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {new Date(signature.signed_at).toLocaleString()}
                        </p>
                        {!!signature.payroll_on_file && (
                          <span className="px-2 py-1 mr-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                            payroll details on file
                          </span>
                        )}
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          signature.status === 'signed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {signature.status}
                        </span>
                      </div>
                    </div>
                  ))}
                  
                  {(!selectedAgreementVersion.signatures || selectedAgreementVersion.signatures.length === 0) && (
                    <div className="text-center py-8 text-gray-500">
                      <FileText className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p>No signatures for this version yet.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Agreement Content Viewer */}
            {showAgreementContent && (
              <div className="card p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Agreement Text: v{showAgreementContent.version}
                  </h3>
                  <button
                    onClick={() => setShowAgreementContent(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
                
                <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
                  <div 
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: showAgreementContent.content }}
                  />
                </div>
                
                <div className="mt-4 text-xs text-gray-500">
                  <p>Created: {new Date(showAgreementContent.created_at).toLocaleString()}</p>
                  <p>Status: {showAgreementContent.is_active ? 'Active' : 'Inactive'}</p>
                  <p>Quiz Question: {showAgreementContent.quiz_question}</p>
                  <p>Expected Answer: {showAgreementContent.quiz_correct_answer}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Investment Tracker Tab */}
        {activeTab === 'deliverables' && (
          <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Investment Tracker - Deliverable Reviews</h2>
              
              {deliverables.length > 0 ? (
                <div className="space-y-4">
                  {deliverables.map((deliverable) => (
                    <div key={deliverable.id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-900 mb-2">{deliverable.title}</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                            <div>
                              <span className="font-medium">Submitted by:</span><br />
                              {deliverable.user_name}
                            </div>
                            <div>
                              <span className="font-medium">Date:</span><br />
                              {new Date(deliverable.deliverable_date || deliverable.created_at).toLocaleDateString()}
                            </div>
                            <div>
                              <span className="font-medium">Original Amount:</span><br />
                              {deliverable.original_amount && deliverable.original_currency ? 
                                `${deliverable.original_currency === 'CAD' ? 'C$' : 
                                  deliverable.original_currency === 'EUR' ? '€' :
                                  deliverable.original_currency === 'GBP' ? '£' : '$'}${deliverable.original_amount} ${deliverable.original_currency}` : 
                                'Not specified'
                              }
                            </div>
                            <div>
                              <span className="font-medium">Theoretical Value:</span><br />
                              {deliverable.theoretical_value_usd ?
                                `$${deliverable.theoretical_value_usd} ${baseCurrency}` :
                                'Not calculated'
                              }
                            </div>
                          </div>
                          
                          {deliverable.exchange_rate && deliverable.risk_multiplier && (
                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded text-sm">
                              <span className="font-medium text-green-800">Investment Calculation:</span>
                              <span className="text-green-700 ml-2">
                                {deliverable.original_amount} × {deliverable.exchange_rate} × {deliverable.risk_multiplier} = ${deliverable.theoretical_value_usd}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            deliverable.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            deliverable.status === 'pending_review' ? 'bg-blue-100 text-blue-800' :
                            deliverable.status === 'approved' ? 'bg-green-100 text-green-800' :
                            deliverable.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {deliverable.status.replace('_', ' ').toUpperCase()}
                          </span>
                        </div>
                      </div>
                      
                      <div className="mb-4">
                        <p className="text-gray-700 text-sm leading-relaxed">
                          {deliverable.content?.substring(0, 200)}
                          {deliverable.content?.length > 200 && '...'}
                        </p>
                      </div>
                      
                      {deliverable.status === 'pending_review' && (
                        <div className="flex items-center space-x-3 pt-4 border-t border-gray-200">
                          <button
                            onClick={() => handleDeliverableAction(deliverable.id, 'approved')}
                            className="btn btn-primary text-sm"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleDeliverableAction(deliverable.id, 'rejected')}
                            className="btn btn-secondary text-sm"
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </button>
                          <button
                            onClick={() => console.log('View details for', deliverable.id)}
                            className="btn btn-outline text-sm"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View Details
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 text-lg">No deliverables to review</p>
                  <p className="text-gray-500 text-sm">Investment tracker submissions will appear here for admin review.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'search-adapters' && <SearchAdaptersTab />}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Platform Settings</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h3 className="font-medium text-blue-900 mb-2">Registration Security</h3>
                  <p className="text-sm text-blue-800">
                    ✅ Public registration is disabled<br/>
                    ✅ Invite-only system active<br/>
                    ✅ Admin approval not required for invited users
                  </p>
                </div>
                
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h3 className="font-medium text-green-900 mb-2">Email Integration</h3>
                  <p className="text-sm text-green-800">
                    ✅ Amazon SES configured<br/>
                    ✅ Welcome emails enabled<br/>
                    ✅ Admin notifications active
                  </p>
                </div>
                
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <h3 className="font-medium text-purple-900 mb-2">GitHub Integration</h3>
                  <p className="text-sm text-purple-800">
                    ⚠️ GitHub token needed for issues sync<br/>
                    ✅ Profile picture sync working<br/>
                    ✅ Username validation active
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPage;