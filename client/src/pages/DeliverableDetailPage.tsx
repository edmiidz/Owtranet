import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  DollarSign,
  Calendar,
  User,
  Tag,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Download,
  FileImage,
  File,
  Loader,
  Edit,
  TrendingUp,
  Trash2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';

interface Deliverable {
  id: number;
  title: string;
  content: string;
  content_html: string;
  amount: number | string | null;
  original_amount: number | string | null;
  original_currency: string | null;
  exchange_rate: number | string | null;
  risk_multiplier: number | string | null;
  status: string;
  type: string;
  user_id: number;
  user_name: string;
  nominee_name: string | null;
  deliverable_date: string;
  created_at: string;
  approved_at: string | null;
  approved_by: number | null;
  approver_name: string | null;
  rejection_reason: string | null;
  attachments: any[];
  tags: any[];
}

const DeliverableDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser } = useAuthStore();
  const navigate = useNavigate();
  const baseCurrency = useBrandingStore((s) => s.baseCurrency);

  const [deliverable, setDeliverable] = useState<Deliverable | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [prevId, setPrevId] = useState<number | null>(null);
  const [nextId, setNextId] = useState<number | null>(null);

  // Format date as yyyy-mm-dd HH:mm:ss UTC
  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
  };

  // Format date as yyyy-mm-dd
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Admin controls
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [updatedAmount, setUpdatedAmount] = useState<number | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({
    nominee_user_id: 0,
    original_amount: '',
    exchange_rate: '',
    risk_multiplier: '',
    investment_category: 'cash',
    content: ''
  });
  const [users, setUsers] = useState<any[]>([]);
  const [multipliers, setMultipliers] = useState({ cash: 2.8, sweat_equity: 2.0, property: 1.0, referral: 1.0 });

  useEffect(() => {
    loadDeliverable();
    loadDeliverableIds();
    if (currentUser?.role === 'admin') {
      loadUsers();
      loadMultipliers();
    }
  }, [id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && prevId) {
        navigate(`/investment-tracker/${prevId}`);
      } else if (e.key === 'ArrowRight' && nextId) {
        navigate(`/investment-tracker/${nextId}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevId, nextId, navigate]);

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/admin/users', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.filter((u: any) => u.role !== 'deactivated' && u.role !== 'system'));
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadMultipliers = async () => {
    try {
      const response = await fetch('/api/investment-settings/multipliers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setMultipliers(data);
      }
    } catch (err) {
      console.error('Failed to load multipliers:', err);
    }
  };

  const loadDeliverableIds = async () => {
    try {
      const response = await fetch('/api/deliverables', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        const ids = data.map((d: any) => d.id).sort((a: number, b: number) => a - b);

        // Find current position and set prev/next
        const currentId = parseInt(id || '0');
        const currentIndex = ids.indexOf(currentId);

        if (currentIndex > 0) {
          setPrevId(ids[currentIndex - 1]);
        } else {
          setPrevId(null);
        }

        if (currentIndex < ids.length - 1 && currentIndex !== -1) {
          setNextId(ids[currentIndex + 1]);
        } else {
          setNextId(null);
        }
      }
    } catch (err) {
      console.error('Failed to load deliverable IDs:', err);
    }
  };

  const loadDeliverable = async () => {
    try {
      setIsLoading(true);
      setError('');

      const response = await fetch(`/api/deliverables/${id}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDeliverable(data);
        setUpdatedAmount(data.amount);
      } else if (response.status === 404) {
        setError('Deliverable not found');
      } else {
        setError('Failed to load deliverable');
      }
    } catch (err) {
      console.error('Failed to load deliverable:', err);
      setError('Failed to load deliverable');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprovalAction = async () => {
    if (!deliverable || !approvalAction) return;

    try {
      setError('');
      setIsSubmitting(true);

      const updateData: any = {
        status: approvalAction === 'approve' ? 'approved' : 'rejected'
      };

      if (approvalAction === 'approve' && updatedAmount !== null) {
        updateData.amount = updatedAmount;
      }

      if (approvalAction === 'reject' && rejectionReason) {
        updateData.rejection_reason = rejectionReason;
      }

      const response = await fetch(`/api/deliverables/${deliverable.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });

      if (response.ok) {
        setSuccess(
          approvalAction === 'approve'
            ? `Deliverable has been approved!`
            : `Deliverable has been rejected.`
        );
        setShowApprovalModal(false);
        setApprovalAction(null);
        setRejectionReason('');
        loadDeliverable(); // Reload deliverable
      } else {
        const errorData = await response.json();
        setError(errorData.error || `Failed to ${approvalAction} deliverable`);
      }
    } catch (err) {
      setError(`Failed to ${approvalAction} deliverable. Please try again.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async () => {
    if (!deliverable) return;

    try {
      setError('');
      setIsSubmitting(true);

      const response = await fetch(`/api/deliverables/${deliverable.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nominee_user_id: editData.nominee_user_id || null,
          original_amount: editData.original_amount ? parseFloat(editData.original_amount) : null,
          exchange_rate: editData.exchange_rate ? parseFloat(editData.exchange_rate) : null,
          risk_multiplier: editData.risk_multiplier ? parseFloat(editData.risk_multiplier) : null,
          investment_category: editData.investment_category,
          content: editData.content
        })
      });

      if (response.ok) {
        setSuccess('Deliverable updated successfully!');
        setShowEditModal(false);
        loadDeliverable();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update deliverable');
      }
    } catch (err) {
      setError('Failed to update deliverable. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };


  const handleDelete = async () => {
    if (!deliverable) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${deliverable.title}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setIsDeleting(true);
      setError('');

      const response = await fetch(`/api/deliverables/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        navigate('/investment-tracker');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete deliverable');
      }
    } catch (err) {
      setError('Failed to delete deliverable. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'draft': return <FileText className="h-5 w-5 text-gray-500" />;
      case 'pending': return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'pending_review': return <AlertCircle className="h-5 w-5 text-blue-500" />;
      case 'approved': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'rejected': return <XCircle className="h-5 w-5 text-red-500" />;
      case 'negotiating': return <DollarSign className="h-5 w-5 text-orange-500" />;
      case 'paid': return <CheckCircle className="h-5 w-5 text-green-600" />;
      default: return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending_review': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'approved': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      case 'negotiating': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'paid': return 'bg-green-100 text-green-900 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatCurrency = (amount: number | string | null, currency: string = baseCurrency) => {
    if (amount === null || amount === undefined) return 'Not specified';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'Not specified';
    const symbol = currency === 'CAD' ? 'C$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${symbol}${numAmount.toFixed(2)} ${currency !== baseCurrency ? currency : ''}`.trim();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !deliverable) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Deliverable</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Link to="/investment-tracker" className="btn btn-primary">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Investment Tracker
        </Link>
      </div>
    );
  }

  if (!deliverable) return null;

  // Admins can always edit deliverables
  const canEdit = currentUser?.role === 'admin';
  const canApprove = currentUser?.role === 'admin' && ['pending', 'pending_review'].includes(deliverable.status);
  const canDelete = currentUser?.role === 'admin' || deliverable.user_id === currentUser?.id;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/investment-tracker"
            className="text-gray-600 hover:text-gray-900 transition-colors"
            title="Back to Investment Tracker"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>

          {/* Navigation buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => prevId && navigate(`/investment-tracker/${prevId}`)}
              disabled={!prevId}
              className={`p-2 rounded-lg transition-colors ${
                prevId
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title={prevId ? `Previous (ID: ${prevId})` : 'No previous deliverable'}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={() => nextId && navigate(`/investment-tracker/${nextId}`)}
              disabled={!nextId}
              className={`p-2 rounded-lg transition-colors ${
                nextId
                  ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  : 'text-gray-300 cursor-not-allowed'
              }`}
              title={nextId ? `Next (ID: ${nextId})` : 'No next deliverable'}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900">{deliverable.title}</h1>
            <p className="text-gray-600">Deliverable #{deliverable.id}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {canEdit && (
            <button
              onClick={() => {
                setEditData({
                  nominee_user_id: deliverable.nominee_name ? (users.find(u => u.name === deliverable.nominee_name)?.id || 0) : 0,
                  original_amount: String(deliverable.original_amount || ''),
                  exchange_rate: String(deliverable.exchange_rate || ''),
                  risk_multiplier: String(deliverable.risk_multiplier || ''),
                  investment_category: (deliverable as any).investment_category || 'cash',
                  content: deliverable.content || ''
                });
                setShowEditModal(true);
              }}
              className="btn btn-secondary"
              title="Edit deliverable"
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="btn bg-red-600 text-white hover:bg-red-700"
              title="Delete this deliverable"
            >
              {isDeleting ? (
                <>
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </button>
          )}
          <div className="flex items-center space-x-2">
            {getStatusIcon(deliverable.status)}
            <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(deliverable.status)}`}>
              {deliverable.status.charAt(0).toUpperCase() + deliverable.status.slice(1).replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Success/Error Messages */}
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

      {/* Status Information for Locked Deliverables */}
      {currentUser?.role === 'admin' && ['approved', 'paid', 'rejected'].includes(deliverable.status) && (
        <div className={`rounded-lg shadow-sm border p-4 ${
          deliverable.status === 'approved' ? 'bg-green-50 border-green-200' :
          deliverable.status === 'paid' ? 'bg-blue-50 border-blue-200' :
          'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center space-x-2">
            {deliverable.status === 'approved' && <CheckCircle className="h-5 w-5 text-green-600" />}
            {deliverable.status === 'paid' && <CheckCircle className="h-5 w-5 text-blue-600" />}
            {deliverable.status === 'rejected' && <XCircle className="h-5 w-5 text-red-600" />}
            <span className="text-sm font-medium text-gray-700">
              {deliverable.status === 'approved' && `This investment has been approved. Values are locked and counted as part of ${deliverable.nominee_name || deliverable.user_name}'s total contribution.`}
              {deliverable.status === 'paid' && 'This deliverable has been paid. No further actions are available.'}
              {deliverable.status === 'rejected' && `This deliverable was rejected. ${deliverable.rejection_reason ? 'See rejection reason below.' : ''}`}
            </span>
          </div>
        </div>
      )}

      {/* Admin Actions Bar - Only show for pending/pending_review */}
      {canApprove && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Admin Actions:</span>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  setApprovalAction('approve');
                  setShowApprovalModal(true);
                }}
                className="btn btn-primary bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve
              </button>
              <button
                onClick={() => {
                  setApprovalAction('reject');
                  setShowApprovalModal(true);
                }}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description/Content */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Description</h2>
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown>{deliverable.content || 'No description provided.'}</ReactMarkdown>
            </div>
          </div>

          {/* Attachments */}
          {deliverable.attachments && deliverable.attachments.length > 0 && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Attachments</h2>
              <div className="space-y-3">
                {deliverable.attachments.map((attachment: any) => {
                  // Extract filename from file_path (e.g., "uploads/deliverables/123_file.pdf" -> "123_file.pdf")
                  const filename = attachment.file_path?.split('/').pop() || attachment.file_name;

                  const handleViewAttachment = async () => {
                    try {
                      const token = localStorage.getItem('owtranet-token');
                      const response = await fetch(`/api/deliverables/documents/${filename}`, {
                        headers: {
                          'Authorization': `Bearer ${token}`
                        }
                      });

                      if (!response.ok) {
                        throw new Error('Failed to fetch document');
                      }

                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      window.open(url, '_blank');

                      // Clean up the URL after a delay
                      setTimeout(() => window.URL.revokeObjectURL(url), 100);
                    } catch (error) {
                      console.error('Error viewing attachment:', error);
                      alert('Failed to load attachment');
                    }
                  };

                  return (
                  <div key={attachment.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      {attachment.file_type?.includes('image') ? (
                        <FileImage className="h-8 w-8 text-blue-500" />
                      ) : attachment.file_type?.includes('pdf') ? (
                        <File className="h-8 w-8 text-red-500" />
                      ) : (
                        <FileText className="h-8 w-8 text-gray-500" />
                      )}
                      <div>
                        <p className="font-medium text-gray-900">{attachment.file_name}</p>
                        <p className="text-sm text-gray-500">
                          {attachment.file_type} • {(attachment.file_size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleViewAttachment}
                      className="btn btn-secondary"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      View
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rejection Reason */}
          {deliverable.rejection_reason && (
            <div className="card p-6 bg-red-50 border-red-200">
              <h2 className="text-lg font-semibold text-red-900 mb-2">Rejection Reason</h2>
              <p className="text-red-700 mb-3">{deliverable.rejection_reason}</p>
              {(deliverable.approver_name || deliverable.approved_at) && (
                <div className="pt-3 border-t border-red-300">
                  <div className="flex items-center text-sm text-red-800">
                    <XCircle className="h-4 w-4 mr-2" />
                    <span>
                      Rejected{deliverable.approved_at && ` on ${formatDateTime(deliverable.approved_at)}`}
                      {deliverable.approver_name && ` by ${deliverable.approver_name}`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Column - Metadata */}
        <div className="space-y-6">
          {/* Financial Details */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2" />
              Financial Details
            </h2>
            <div className="space-y-3">
              {/* Investment Category */}
              {(deliverable as any).investment_category && (
                <div>
                  <span className="text-sm text-gray-500 block">Investment Category</span>
                  <span className="text-lg font-medium text-gray-900 capitalize">
                    {(deliverable as any).investment_category === 'sweat_equity' ? 'Sweat Equity' :
                     (deliverable as any).investment_category === 'property' ? 'Property' : 'Cash'}
                  </span>
                </div>
              )}

              {deliverable.original_amount && (
                <>
                  <div>
                    <span className="text-sm text-gray-500 block">Original Amount</span>
                    <span className="text-lg font-medium text-gray-900">
                      {formatCurrency(deliverable.original_amount, deliverable.original_currency || baseCurrency)}
                    </span>
                  </div>
                  {deliverable.exchange_rate && deliverable.exchange_rate !== 1 && (
                    <div>
                      <span className="text-sm text-gray-500 block">Exchange Rate</span>
                      <span className="text-lg font-medium text-gray-900">{deliverable.exchange_rate}</span>
                    </div>
                  )}
                  {deliverable.amount && deliverable.original_currency && deliverable.original_currency !== baseCurrency && (
                    <div>
                      <span className="text-sm text-gray-500 block">{baseCurrency} Amount</span>
                      <span className="text-lg font-medium text-gray-900">{formatCurrency(deliverable.amount, baseCurrency)}</span>
                    </div>
                  )}
                  {deliverable.risk_multiplier && (
                    <div>
                      <span className="text-sm text-gray-500 block">Risk Multiplier</span>
                      <span className="text-lg font-medium text-gray-900">{deliverable.risk_multiplier}x</span>
                    </div>
                  )}
                </>
              )}
              <div className="pt-3 border-t border-gray-200">
                <span className="text-sm text-gray-500 block">Final Theoretical Value ({baseCurrency})</span>
                <span className="text-xl font-bold text-green-600">
                  {(() => {
                    // Calculate: original_amount × exchange_rate × risk_multiplier
                    const theoreticalValue = (deliverable as any).theoretical_value_usd ||
                      (deliverable.original_amount && deliverable.exchange_rate && deliverable.risk_multiplier
                        ? parseFloat(String(deliverable.original_amount)) *
                          parseFloat(String(deliverable.exchange_rate)) *
                          parseFloat(String(deliverable.risk_multiplier))
                        : deliverable.amount);
                    return theoreticalValue ? formatCurrency(theoreticalValue, baseCurrency) : 'To be determined';
                  })()}
                </span>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Details</h2>
            <div className="space-y-3 text-sm">
              {/* Nominee - ALWAYS show this as it's the most important field */}
              <div className="flex items-start">
                <User className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                <div>
                  <span className="text-gray-500 font-semibold">Nominee</span>
                  <p className={`font-medium ${deliverable.nominee_name ? 'text-gray-900' : 'text-red-600'}`}>
                    {deliverable.nominee_name || 'NOT SET - Please edit to assign'}
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <User className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                <div>
                  <span className="text-gray-500">Submitted by</span>
                  <p className="font-medium text-gray-900">{deliverable.user_name}</p>
                </div>
              </div>

              <div className="flex items-start">
                <Calendar className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                <div>
                  <span className="text-gray-500">Deliverable Date</span>
                  <p className="font-medium text-gray-900">
                    {formatDate(deliverable.deliverable_date || deliverable.created_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <Clock className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                <div>
                  <span className="text-gray-500">Submitted</span>
                  <p className="font-medium text-gray-900">
                    {formatDateTime(deliverable.created_at)}
                  </p>
                </div>
              </div>

              {deliverable.approved_at && (
                <div className="flex items-start">
                  <CheckCircle className="h-4 w-4 text-green-500 mr-2 mt-0.5" />
                  <div>
                    <span className="text-gray-500">Approved</span>
                    <p className="font-medium text-gray-900">
                      {formatDateTime(deliverable.approved_at)}
                    </p>
                    {deliverable.approver_name && (
                      <p className="text-xs text-gray-500">by {deliverable.approver_name}</p>
                    )}
                  </div>
                </div>
              )}

              {deliverable.type && (
                <div className="flex items-start">
                  <FileText className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                  <div>
                    <span className="text-gray-500">Type</span>
                    <p className="font-medium text-gray-900 capitalize">{deliverable.type}</p>
                  </div>
                </div>
              )}

              {deliverable.tags && deliverable.tags.length > 0 && (
                <div className="flex items-start">
                  <Tag className="h-4 w-4 text-gray-400 mr-2 mt-0.5" />
                  <div>
                    <span className="text-gray-500">Tags</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {deliverable.tags.map((tag: any) => (
                        <span key={tag.id} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Edit Deliverable</h3>

            <div className="space-y-4">
              {/* Nominee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nominee (Optional)
                </label>
                <select
                  value={editData.nominee_user_id}
                  onChange={(e) => setEditData({ ...editData, nominee_user_id: parseInt(e.target.value) })}
                  className="form-select w-full"
                >
                  <option value={0}>None</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>

              {/* Original Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Original Amount ({deliverable.original_currency || baseCurrency})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editData.original_amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setEditData({ ...editData, original_amount: value });
                    }
                  }}
                  className="form-input w-full"
                  placeholder="0.00"
                />
              </div>

              {/* Exchange Rate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exchange Rate (to {baseCurrency})
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editData.exchange_rate}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setEditData({ ...editData, exchange_rate: value });
                    }
                  }}
                  className="form-input w-full"
                  placeholder="1.0"
                />
              </div>

              {/* Investment Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Investment Category
                </label>
                <select
                  value={editData.investment_category}
                  onChange={(e) => {
                    const newCategory = e.target.value;
                    setEditData({
                      ...editData,
                      investment_category: newCategory,
                      risk_multiplier: String(multipliers[newCategory as keyof typeof multipliers])
                    });
                  }}
                  className="form-select w-full"
                >
                  <option value="cash">Cash (×{multipliers.cash})</option>
                  <option value="sweat_equity">Sweat Equity (×{multipliers.sweat_equity})</option>
                  <option value="property">Property (×{multipliers.property})</option>
                  <option value="referral">Referral (×{multipliers.referral})</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Changing category will auto-update the risk multiplier
                </p>
              </div>

              {/* Risk Multiplier */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Risk Multiplier
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editData.risk_multiplier}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setEditData({ ...editData, risk_multiplier: value });
                    }
                  }}
                  className="form-input w-full bg-gray-50"
                  placeholder="1.0"
                />
                <p className="mt-1 text-xs text-gray-500">Auto-set by category (admin can override)</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={editData.content}
                  onChange={(e) => setEditData({ ...editData, content: e.target.value })}
                  className="form-input w-full"
                  rows={6}
                  placeholder="Deliverable description (supports markdown)..."
                />
              </div>

              {/* Preview Calculation */}
              {editData.original_amount && editData.exchange_rate && editData.risk_multiplier && (
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-blue-900">Calculated Final Theoretical Value:</p>
                  <p className="text-lg font-bold text-blue-600">
                    ${(parseFloat(editData.original_amount || '0') *
                       parseFloat(editData.exchange_rate || '1') *
                       parseFloat(editData.risk_multiplier || '1')).toFixed(2)} {baseCurrency}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <Loader className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval/Rejection Modal */}
      {showApprovalModal && approvalAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {approvalAction === 'approve' ? 'Approve Deliverable' : 'Reject Deliverable'}
            </h3>

            {approvalAction === 'approve' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Final Amount ({baseCurrency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={updatedAmount || ''}
                  onChange={(e) => setUpdatedAmount(e.target.value ? parseFloat(e.target.value) : null)}
                  className="form-input"
                  placeholder={deliverable.amount?.toString() || '0.00'}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Update the amount if needed, or leave as-is to keep the current value
                </p>
              </div>
            )}

            {approvalAction === 'reject' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="form-input"
                  rows={4}
                  placeholder="Provide detailed feedback for the submitter..."
                />
                <p className="mt-1 text-xs text-gray-500">
                  This feedback will be visible to the submitter
                </p>
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowApprovalModal(false);
                  setApprovalAction(null);
                  setRejectionReason('');
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleApprovalAction}
                disabled={isSubmitting}
                className={`btn ${approvalAction === 'approve' ? 'btn-primary' : 'bg-red-600 text-white hover:bg-red-700'}`}
              >
                {isSubmitting ? (
                  <>
                    <Loader className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {approvalAction === 'approve' ? (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    {approvalAction === 'approve' ? 'Approve Deliverable' : 'Reject Deliverable'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeliverableDetailPage;