import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Receipt,
  CreditCard,
  Mail,
  Building2
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import LinkifiedText from '../components/LinkifiedText';

const API_BASE = '';

// Expense categories
const EXPENSE_CATEGORIES: Record<string, string> = {
  office_supplies: 'Office Supplies',
  travel: 'Travel',
  meals: 'Meals & Entertainment',
  software: 'Software & Subscriptions',
  hardware: 'Hardware & Equipment',
  professional_services: 'Professional Services',
  marketing: 'Marketing',
  utilities: 'Utilities',
  rent: 'Rent',
  insurance: 'Insurance',
  maintenance: 'Maintenance',
  income: 'Income / Sales',
  other: 'Other'
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  pending: 'bg-yellow-100 text-yellow-800',
  pending_review: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-gray-100 text-gray-500'
};

interface LedgerEntry {
  id: number;
  user_id: number;
  user_name: string;
  payee_user_id: number | null;
  payee_name: string | null;
  expense_category: string;
  title: string;
  description: string | null;
  content: string | null;
  subtotal: number | null;
  gst_amount: number | null;
  gst_rate: number | null;
  pst_amount: number | null;
  pst_rate: number | null;
  hst_amount: number | null;
  hst_rate: number | null;
  other_tax_amount: number | null;
  other_tax_description: string | null;
  tax_total: number | null;
  total_with_tax: number | null;
  amount: number | null;
  original_amount: number | null;
  original_currency: string;
  exchange_rate: number | null;
  vendor_name: string | null;
  receipt_number: string | null;
  expense_date: string;
  status: string;
  is_draft: number;
  is_reimbursable: number;
  payment_method: string | null;
  payment_reference: string | null;
  project_code: string | null;
  paid_date: string | null;
  source: string;
  source_email_subject: string | null;
  approved_by: number | null;
  approver_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ExchangeRate {
  rate: number;
  date: string;
}

const LedgerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user: currentUser, token } = useAuthStore();
  const baseCurrency = useBrandingStore((s) => s.baseCurrency);
  const navigate = useNavigate();

  const [entry, setEntry] = useState<LedgerEntry | null>(null);
  const [cadRate, setCadRate] = useState<ExchangeRate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const formatCurrency = (amount: number | null, currency = baseCurrency) => {
    if (amount === null) return '-';
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency
    }).format(amount);
  };

  // Convert between USD and CAD
  // cadRate.rate is CAD per USD (e.g., 0.71 means 1 USD = 0.71 CAD, which is inverted)
  // Actually the rate seems inverted in DB. Let's handle both directions properly.
  // If rate is ~0.71, that's likely meant to be 1 CAD = 0.71 USD
  const convertCurrency = (amount: number | null, fromCurrency: string, toCurrency: string): number | null => {
    if (amount === null || !cadRate) return null;
    if (fromCurrency === toCurrency) return amount;

    // cadRate.rate represents: 1 CAD = X USD (where X is ~0.71)
    if (fromCurrency === 'CAD' && toCurrency === 'USD') {
      return amount * cadRate.rate; // CAD to USD
    } else if (fromCurrency === 'USD' && toCurrency === 'CAD') {
      return amount / cadRate.rate; // USD to CAD
    }
    return amount;
  };

  useEffect(() => {
    loadEntry();
    loadEntryIds();
    loadExchangeRate();
  }, [id]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && prevId) {
        navigate(`/ledger/${prevId}`);
      } else if (e.key === 'ArrowRight' && nextId) {
        navigate(`/ledger/${nextId}`);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [prevId, nextId, navigate]);

  const loadExchangeRate = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/exchange-rates/latest?currency=CAD`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCadRate(data);
      }
    } catch (err) {
      console.error('Failed to load exchange rate:', err);
      setCadRate({ rate: 0.71, date: new Date().toISOString() });
    }
  };

  const loadEntry = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE}/api/ledger/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError('Expense entry not found');
        } else {
          throw new Error('Failed to load entry');
        }
        return;
      }

      const data = await response.json();
      setEntry(data);
    } catch (err) {
      setError('Failed to load expense entry');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadEntryIds = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ledger`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const entries = await response.json();
        const currentIndex = entries.findIndex((e: any) => e.id === parseInt(id || '0'));

        if (currentIndex > 0) {
          setPrevId(entries[currentIndex - 1].id);
        } else {
          setPrevId(null);
        }

        if (currentIndex < entries.length - 1 && currentIndex >= 0) {
          setNextId(entries[currentIndex + 1].id);
        } else {
          setNextId(null);
        }
      }
    } catch (err) {
      console.error('Failed to load entry IDs:', err);
    }
  };

  const handleApprove = async (action: 'approve' | 'reject') => {
    try {
      setIsSubmitting(true);
      const rejection_reason = action === 'reject'
        ? prompt('Enter rejection reason:')
        : undefined;

      if (action === 'reject' && !rejection_reason) {
        setIsSubmitting(false);
        return;
      }

      const response = await fetch(`${API_BASE}/api/ledger/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action, rejection_reason })
      });

      if (!response.ok) throw new Error('Failed to process');
      setSuccess(`Entry ${action}d successfully`);
      loadEntry();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to process entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkPaid = async () => {
    const payment_reference = prompt('Enter payment reference (optional):');

    try {
      setIsSubmitting(true);
      const response = await fetch(`${API_BASE}/api/ledger/${id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ payment_reference })
      });

      if (!response.ok) throw new Error('Failed to mark as paid');
      setSuccess('Entry marked as paid');
      loadEntry();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to mark as paid');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this expense entry?')) return;

    try {
      setIsSubmitting(true);
      const response = await fetch(`${API_BASE}/api/ledger/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete');
      navigate('/ledger');
    } catch (err) {
      setError('Failed to delete entry');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error && !entry) {
    return (
      <div className="max-w-4xl mx-auto">
        <Link to="/ledger" className="flex items-center gap-2 text-blue-600 hover:underline mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Ledger
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      </div>
    );
  }

  if (!entry) return null;

  // Get the amount in its original currency
  const originalAmount = entry.total_with_tax || entry.subtotal || entry.amount || 0;
  const originalCurrency = entry.original_currency || baseCurrency;

  // Primary figure is in the base currency; CAD line is a secondary reference
  // (only meaningful when the base currency itself is not CAD).
  const usdAmount = originalCurrency === baseCurrency ? originalAmount : convertCurrency(originalAmount, originalCurrency, baseCurrency);
  const cadAmount = originalCurrency === 'CAD' ? originalAmount : convertCurrency(originalAmount, originalCurrency, 'CAD');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <Link to="/ledger" className="flex items-center gap-2 text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Back to Ledger
        </Link>
        <div className="flex items-center gap-2">
          {prevId && (
            <Link
              to={`/ledger/${prevId}`}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Previous entry (Left Arrow)"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
          )}
          <span className="text-sm text-gray-500">#{entry.id}</span>
          {nextId && (
            <Link
              to={`/ledger/${nextId}`}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Next entry (Right Arrow)"
            >
              <ChevronRight className="h-5 w-5" />
            </Link>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          {success}
        </div>
      )}

      {/* Main Content */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Receipt className="h-6 w-6 text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-900">{entry.title}</h1>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[entry.status] || STATUS_COLORS.pending}`}>
                  {entry.status.replace('_', ' ')}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(entry.expense_date)}
                </span>
                {entry.source === 'email' && (
                  <span className="flex items-center gap-1 text-blue-600">
                    <Mail className="h-4 w-4" />
                    Via Email
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Original: {originalCurrency}</p>
              <p className="text-3xl font-bold text-gray-900">{formatCurrency(usdAmount, baseCurrency)}</p>
              {cadAmount && baseCurrency !== 'CAD' && (
                <p className="text-lg text-gray-500">{formatCurrency(cadAmount, 'CAD')}</p>
              )}
            </div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Category</h3>
              <p className="text-gray-900">{EXPENSE_CATEGORIES[entry.expense_category] || entry.expense_category}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Submitted By</h3>
              <p className="text-gray-900 flex items-center gap-2">
                <User className="h-4 w-4" />
                {entry.user_name}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Allocated To</h3>
              <p className="text-gray-900 flex items-center gap-2">
                <User className="h-4 w-4" />
                {entry.payee_name || <span className="text-gray-400">Unassigned</span>}
              </p>
            </div>

            {entry.vendor_name && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Vendor</h3>
                <p className="text-gray-900 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {entry.vendor_name}
                </p>
              </div>
            )}

            {entry.receipt_number && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Receipt/Invoice #</h3>
                <p className="text-gray-900">{entry.receipt_number}</p>
              </div>
            )}

            {entry.payment_method && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Payment Method</h3>
                <p className="text-gray-900 capitalize">{entry.payment_method.replace('_', ' ')}</p>
              </div>
            )}

            {entry.project_code && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-1">Project</h3>
                <p className="text-gray-900">{entry.project_code}</p>
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Reimbursable</h3>
              <p className="text-gray-900">{entry.is_reimbursable ? 'Yes' : 'No'}</p>
            </div>
          </div>

          {/* Right Column - Amounts */}
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Amount Breakdown</h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Original Currency:</span>
                  <span className="font-medium">{entry.original_currency || baseCurrency}</span>
                </div>

                {entry.original_amount && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Original Amount:</span>
                    <span className="font-medium">
                      {formatCurrency(entry.original_amount, entry.original_currency || baseCurrency)}
                    </span>
                  </div>
                )}

                {entry.exchange_rate && entry.exchange_rate !== 1 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Exchange Rate:</span>
                    <span className="font-medium">{entry.exchange_rate}</span>
                  </div>
                )}

                {entry.subtotal && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal ({baseCurrency}):</span>
                    <span className="font-medium">{formatCurrency(entry.subtotal, baseCurrency)}</span>
                  </div>
                )}

                {entry.gst_amount && entry.gst_amount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>GST ({((entry.gst_rate || 0) * 100).toFixed(0)}%):</span>
                    <span>{formatCurrency(entry.gst_amount, baseCurrency)}</span>
                  </div>
                )}

                {entry.pst_amount && entry.pst_amount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>PST ({((entry.pst_rate || 0) * 100).toFixed(2)}%):</span>
                    <span>{formatCurrency(entry.pst_amount, baseCurrency)}</span>
                  </div>
                )}

                {entry.other_tax_amount && entry.other_tax_amount > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>{entry.other_tax_description || 'Other Tax'}:</span>
                    <span>{formatCurrency(entry.other_tax_amount, baseCurrency)}</span>
                  </div>
                )}

                {entry.tax_total && entry.tax_total > 0 && (
                  <div className="flex justify-between text-gray-600 border-t pt-2">
                    <span>Tax Total:</span>
                    <span>{formatCurrency(entry.tax_total, baseCurrency)}</span>
                  </div>
                )}

                <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
                  <span>Total ({baseCurrency}):</span>
                  <span>{formatCurrency(usdAmount, baseCurrency)}</span>
                </div>

                {cadAmount && baseCurrency !== 'CAD' && (
                  <div className="flex justify-between text-gray-500">
                    <span>Total (CAD):</span>
                    <span>{formatCurrency(cadAmount, 'CAD')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description */}
        {(entry.description || entry.content) && (
          <div className="px-6 pb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Description</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-700 whitespace-pre-wrap"><LinkifiedText text={entry.description || entry.content || ""} /></p>
            </div>
          </div>
        )}

        {/* Rejection Reason */}
        {entry.rejection_reason && (
          <div className="px-6 pb-6">
            <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-red-800 mb-1">Rejection Reason</h3>
              <p className="text-red-700">{entry.rejection_reason}</p>
            </div>
          </div>
        )}

        {/* Approval Info */}
        {entry.approved_at && (
          <div className="px-6 pb-6">
            <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-green-800 mb-1">
                {entry.status === 'rejected' ? 'Rejected' : 'Approved'}
              </h3>
              <p className="text-green-700">
                By {entry.approver_name} on {formatDateTime(entry.approved_at)}
              </p>
            </div>
          </div>
        )}

        {/* Payment Info */}
        {entry.paid_date && (
          <div className="px-6 pb-6">
            <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-purple-800 mb-1">Payment Recorded</h3>
              <p className="text-purple-700">
                Paid on {formatDate(entry.paid_date)}
                {entry.payment_reference && ` (Ref: ${entry.payment_reference})`}
              </p>
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="px-6 pb-6 text-xs text-gray-400">
          <p>Created: {formatDateTime(entry.created_at)}</p>
          {entry.updated_at && <p>Updated: {formatDateTime(entry.updated_at)}</p>}
          {entry.source_email_subject && <p>Email Subject: {entry.source_email_subject}</p>}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 border-t flex flex-wrap gap-3">
          {/* Edit/Delete for owner or admin */}
          {(entry.user_id === currentUser?.id || currentUser?.role === 'admin') &&
           ['draft', 'pending', 'pending_review', 'rejected'].includes(entry.status) && (
            <>
              <Link
                to={`/ledger?edit=${entry.id}`}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Edit className="h-4 w-4" />
                Edit
              </Link>
              <button
                onClick={handleDelete}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </>
          )}

          {/* Admin approve/reject */}
          {currentUser?.role === 'admin' && ['pending', 'pending_review'].includes(entry.status) && (
            <>
              <button
                onClick={() => handleApprove('approve')}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                Approve
              </button>
              <button
                onClick={() => handleApprove('reject')}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
            </>
          )}

          {/* Admin mark as paid */}
          {currentUser?.role === 'admin' && entry.status === 'approved' && (
            <button
              onClick={handleMarkPaid}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              Mark as Paid
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LedgerDetailPage;
