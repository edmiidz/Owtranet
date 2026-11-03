import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Receipt,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Edit,
  Trash2,
  Eye,
  FileText,
  CreditCard,
  Mail,
  Search,
  TrendingUp,
  Briefcase,
  User,
  ArrowUp,
  ArrowDown,
  X
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';

const API_BASE = '';

// Expense categories
const EXPENSE_CATEGORIES = [
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals & Entertainment' },
  { value: 'software', label: 'Software & Subscriptions' },
  { value: 'hardware', label: 'Hardware & Equipment' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'rent', label: 'Rent' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'income', label: 'Income / Sales' },
  { value: 'other', label: 'Other' }
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  pending: 'bg-yellow-100 text-yellow-800',
  under_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-gray-100 text-gray-500'
};

const ledgerSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  expense_category: z.string(),
  description: z.string().optional(),
  expense_date: z.string().min(1, 'Expense date is required'),
  vendor_name: z.string().optional(),
  receipt_number: z.string().optional(),
  subtotal: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(0).optional()
  ),
  gst_rate: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(0).max(1).optional()
  ),
  pst_rate: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(0).max(1).optional()
  ),
  other_tax_percent: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? undefined : Number(val),
    z.number().min(0).max(100).optional()
  ),
  other_tax_description: z.string().optional(),
  original_currency: z.string().optional(),
  payment_method: z.string().optional(),
  payment_reference: z.string().optional(),
  project_code: z.string().optional(),
  payee_user_id: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? undefined : Number(val),
    z.number().int().positive().optional()
  ),
  is_reimbursable: z.boolean().optional()
});

type LedgerFormData = z.infer<typeof ledgerSchema>;

interface LedgerEntry {
  id: number;
  user_id: number;
  user_name: string;
  payee_user_id: number | null;
  payee_name: string | null;
  expense_category: string;
  title: string;
  description: string | null;
  subtotal: number | null;
  gst_amount: number | null;
  gst_rate: number | null;
  pst_amount: number | null;
  pst_rate: number | null;
  hst_amount: number | null;
  hst_rate: number | null;
  tax_total: number | null;
  total_with_tax: number | null;
  original_amount: number | null;
  original_currency: string;
  vendor_name: string | null;
  receipt_number: string | null;
  expense_date: string;
  status: string;
  is_draft: number;
  is_reimbursable: number;
  payment_method: string | null;
  payment_reference: string | null;
  project_code: string | null;
  source: string;
  approved_by: number | null;
  approver_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface Stats {
  total_entries: number;
  drafts: number;
  pending: number;
  approved: number;
  paid: number;
  rejected: number;
  approved_total: number;
  paid_total: number;
  pending_total: number;
  income_count: number;
  income_total: number;
}

interface ExchangeRate {
  rate: number;
  date: string;
}

const LedgerPage: React.FC = () => {
  const { user, token } = useAuthStore();
  const baseCurrency = useBrandingStore((s) => s.baseCurrency);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cadRate, setCadRate] = useState<ExchangeRate | null>(null);
  // Members the expense can be allocated to (payee dropdown).
  const [users, setUsers] = useState<{ id: number; name: string; email: string }[]>([]);
  // Distinct projects (from GET /api/ledger/projects) for the project filter.
  const [projects, setProjects] = useState<{ project: string; entries: number; income_total: number; expense_total: number; net_total: number }[]>([]);
  // Per-member cashflow (from GET /api/ledger/members) for the "By Member" panel.
  const [members, setMembers] = useState<{ user_id: number; member: string; entries: number; income_total: number; expense_total: number; net_total: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);
  // Client-side sort for the table. Default: date descending (server order).
  // Clicking the Date or Amount header cycles/ toggles the sort direction.
  const [sortField, setSortField] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Clicking a sortable header: same field flips direction; new field starts desc.
  const toggleSort = (field: 'date' | 'amount') => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // The base-currency amount used for a row (mirrors the row render below).
  const rowAmount = (e: LedgerEntry) => e.total_with_tax || e.subtotal || 0;
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // URL is the source of truth for filters/search so links like
  // /ledger?search=2702&status=pending are shareable and survive refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || '';
  const categoryFilter = searchParams.get('expense_category') || '';
  const projectFilter = searchParams.get('project') || '';
  const memberFilter = searchParams.get('member') || '';
  const searchTerm = searchParams.get('search') || '';

  // Local mirror of the search box so typing stays snappy; we debounce the
  // write-back into the URL (and thus the API fetch) below.
  const [searchInput, setSearchInput] = useState<string>(searchTerm);

  // Patch a single query param without clobbering the others.
  const updateParam = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<LedgerFormData>({
    resolver: zodResolver(ledgerSchema),
    defaultValues: {
      expense_category: 'other',
      original_currency: baseCurrency,
      is_reimbursable: true
    }
  });

  // Watch subtotal and tax rates to calculate totals
  const subtotal = watch('subtotal');
  const gstRate = watch('gst_rate');
  const pstRate = watch('pst_rate');
  const otherTaxPercent = watch('other_tax_percent');

  const calculateTotals = () => {
    const sub = subtotal || 0;
    const gst = sub * (gstRate || 0);
    const pst = sub * (pstRate || 0);
    const otherTax = sub * ((otherTaxPercent || 0) / 100);
    const taxTotal = gst + pst + otherTax;
    const total = sub + taxTotal;
    return { gst, pst, otherTax, taxTotal, total };
  };

  const totals = calculateTotals();

  // Sorted view of the fetched entries (client-side; the server returns them
  // date-desc). Amount sorts on the base-currency amount; date on expense_date.
  const sortedEntries = [...entries].sort((a, b) => {
    let cmp: number;
    if (sortField === 'amount') {
      cmp = rowAmount(a) - rowAmount(b);
    } else {
      cmp = a.expense_date.localeCompare(b.expense_date);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const fetchEntries = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (categoryFilter) params.append('expense_category', categoryFilter);
      if (projectFilter) params.append('project', projectFilter);
      if (memberFilter) params.append('member', memberFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());

      const response = await fetch(`${API_BASE}/api/ledger?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch entries');
      const data = await response.json();
      setEntries(data);
    } catch (err) {
      setError('Failed to load ledger entries');
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ledger/stats/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const fetchExchangeRate = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/exchange-rates/latest?currency=CAD`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch exchange rate');
      const data = await response.json();
      setCadRate(data);
    } catch (err) {
      console.error('Failed to load exchange rate:', err);
      // Default fallback rate
      setCadRate({ rate: 0.71, date: new Date().toISOString() });
    }
  };

  // Load members once, for the "Allocated to" (payee) dropdown.
  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  // Load distinct projects for the project filter dropdown.
  const fetchProjects = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ledger/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  // Load per-member cashflow for the "By Member" panel.
  const fetchMembers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ledger/members`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch members');
      const data = await response.json();
      setMembers(data);
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchEntries(), fetchStats(), fetchExchangeRate(), fetchProjects(), fetchMembers()]);
      setIsLoading(false);
    };
    loadData();
  }, [statusFilter, categoryFilter, projectFilter, memberFilter, searchTerm]);

  // Keep the input in sync if the URL changes from elsewhere (back/forward,
  // an external link). Avoids stomping what the user is mid-typing.
  useEffect(() => {
    setSearchInput(searchTerm);
  }, [searchTerm]);

  // Debounce search input -> URL (300ms) so we don't fetch on every keystroke.
  // The URL change drives the fetch via the effect above.
  useEffect(() => {
    if (searchInput === searchTerm) return;
    const t = setTimeout(() => updateParam('search', searchInput.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const onSubmit = async (data: LedgerFormData) => {
    try {
      setError('');
      const { gst, pst, otherTax, taxTotal, total } = calculateTotals();

      const payload = {
        ...data,
        gst_amount: gst || null,
        pst_amount: pst || null,
        other_tax_amount: otherTax || null,
        other_tax_description: data.other_tax_description || null,
        tax_total: taxTotal || null,
        total_with_tax: total || null,
        amount: total || null,
        original_amount: data.subtotal || null,
        status: 'pending',
        is_draft: 0
      };

      const url = editingEntry
        ? `${API_BASE}/api/ledger/${editingEntry.id}`
        : `${API_BASE}/api/ledger`;

      const response = await fetch(url, {
        method: editingEntry ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save entry');
      }

      setSuccess(editingEntry ? 'Entry updated successfully' : 'Entry created successfully');
      setShowForm(false);
      setEditingEntry(null);
      reset();
      fetchEntries();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEdit = (entry: LedgerEntry) => {
    setEditingEntry(entry);
    // Convert other_tax_amount back to percentage if subtotal exists
    const otherTaxPercent = entry.subtotal && (entry as any).other_tax_amount
      ? ((entry as any).other_tax_amount / entry.subtotal) * 100
      : undefined;
    reset({
      title: entry.title,
      expense_category: entry.expense_category,
      description: entry.description || '',
      expense_date: entry.expense_date.split('T')[0],
      vendor_name: entry.vendor_name || '',
      receipt_number: entry.receipt_number || '',
      subtotal: entry.subtotal || undefined,
      gst_rate: entry.gst_rate || undefined,
      pst_rate: entry.pst_rate || undefined,
      other_tax_percent: otherTaxPercent,
      other_tax_description: (entry as any).other_tax_description || '',
      original_currency: entry.original_currency || baseCurrency,
      payment_method: entry.payment_method || '',
      payment_reference: entry.payment_reference || '',
      project_code: entry.project_code || '',
      payee_user_id: entry.payee_user_id ?? undefined,
      is_reimbursable: entry.is_reimbursable === 1
    });
    setShowForm(true);
  };

  // Support deep-linking to the edit modal, e.g. the detail page's Edit button
  // navigates to /ledger?edit=<id>. Open that entry's editor (preferring the
  // already-loaded list, else fetching it by id so an active filter/search
  // can't hide it), then strip the param so it doesn't re-fire or persist.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    // Wait for the initial list load before deciding we need a direct fetch.
    if (isLoading) return;

    const open = async () => {
      let entry = entries.find(e => String(e.id) === editId) || null;
      if (!entry) {
        try {
          const response = await fetch(`${API_BASE}/api/ledger/${editId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (response.ok) entry = await response.json();
        } catch {
          // fall through — we'll just clear the param below
        }
      }
      if (entry) handleEdit(entry);
      updateParam('edit', '');
    };
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, isLoading, entries]);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;

    try {
      const response = await fetch(`${API_BASE}/api/ledger/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete');
      setSuccess('Entry deleted successfully');
      fetchEntries();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to delete entry');
    }
  };

  const handleApprove = async (id: number, action: 'approve' | 'reject') => {
    try {
      const rejection_reason = action === 'reject'
        ? prompt('Enter rejection reason:')
        : undefined;

      if (action === 'reject' && !rejection_reason) return;

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
      fetchEntries();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to process entry');
    }
  };

  const handleMarkPaid = async (id: number) => {
    const payment_reference = prompt('Enter payment reference (optional):');

    try {
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
      fetchEntries();
      fetchStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to mark as paid');
    }
  };

  const formatCurrency = (amount: number | null, currency = baseCurrency) => {
    if (amount === null) return '-';
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency
    }).format(amount);
  };

  // The `amount` column is stored in the base currency, so stat tiles and row
  // totals format directly in baseCurrency — no live conversion needed. The
  // foreign `original_amount`/`original_currency` (e.g. the USD a charge was
  // billed in before it posted to a CAD card) is shown only as a secondary
  // reference next to the base figure.
  const formatBase = (amount: number | null) => formatCurrency(amount, baseCurrency);

  // Secondary reference: the original foreign amount, when it differs from base.
  // Returns null when there is nothing extra to show (same currency / no value).
  const formatOriginalRef = (
    originalAmount: number | null,
    originalCurrency: string | null | undefined
  ): string | null => {
    const cur = (originalCurrency || baseCurrency).toUpperCase();
    if (originalAmount === null || cur === baseCurrency) return null;
    return formatCurrency(originalAmount, cur);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ledger</h1>
          <p className="text-gray-600">Track expenses, income, and receipts</p>
          <p className="text-sm text-blue-600 mt-1">
            Base currency: {baseCurrency}
            {cadRate && baseCurrency !== 'CAD' && (
              <span className="ml-2 text-gray-500">
                | Today's rate: 1 USD = {(1 / cadRate.rate).toFixed(4)} CAD
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            setEditingEntry(null);
            reset({
              expense_category: 'other',
              original_currency: baseCurrency,
              is_reimbursable: true,
              expense_date: new Date().toISOString().split('T')[0]
            });
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="h-5 w-5" />
          New Entry
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-gray-600">
              <FileText className="h-4 w-4" />
              <span className="text-sm">Drafts</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.drafts}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-yellow-600">
              <Clock className="h-4 w-4" />
              <span className="text-sm">Pending</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-sm text-gray-700">{formatBase(stats.pending_total)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">Approved</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
            <p className="text-sm text-gray-700">{formatBase(stats.approved_total)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-purple-600">
              <CreditCard className="h-4 w-4" />
              <span className="text-sm">Paid</span>
            </div>
            <p className="text-2xl font-bold text-purple-600">{stats.paid}</p>
            <p className="text-sm text-gray-700">{formatBase(stats.paid_total)}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="h-4 w-4" />
              <span className="text-sm">Rejected</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-gray-600">
              <Receipt className="h-4 w-4" />
              <span className="text-sm">Total</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{stats.total_entries}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center gap-2 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm">Income</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">{stats.income_count ?? 0}</p>
            <p className="text-sm text-gray-700">{formatBase(stats.income_total ?? 0)}</p>
          </div>
        </div>
      )}

      {/* Per-project rollup: income vs expenses vs net for each project.
          Clicking a card toggles the project filter (same URL param the
          dropdown uses). */}
      {projects.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            By Project
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => {
              const net = Number(p.net_total);
              const isActive = projectFilter === p.project;
              return (
                <button
                  key={p.project}
                  type="button"
                  onClick={() => updateParam('project', isActive ? '' : p.project)}
                  className={`text-left bg-white p-4 rounded-lg shadow-sm border transition-colors ${
                    isActive ? 'border-blue-500 ring-1 ring-blue-500' : 'hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-gray-700 min-w-0">
                      <Briefcase className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm font-medium truncate" title={p.project}>{p.project}</span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{p.entries} {p.entries === 1 ? 'entry' : 'entries'}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Income</p>
                      <p className="text-sm font-medium text-emerald-600">{formatBase(Number(p.income_total))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Expenses</p>
                      <p className="text-sm font-medium text-gray-700">{formatBase(Number(p.expense_total))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Net</p>
                      <p className={`text-sm font-semibold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatBase(net)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-member cashflow: income brought in vs expenses paid, net per member.
          Clicking a card toggles the member filter. */}
      {members.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            By Member
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map((m) => {
              const net = Number(m.net_total);
              const isActive = memberFilter === String(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => updateParam('member', isActive ? '' : String(m.user_id))}
                  className={`text-left bg-white p-4 rounded-lg shadow-sm border transition-colors ${
                    isActive ? 'border-blue-500 ring-1 ring-blue-500' : 'hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-gray-700 min-w-0">
                      <User className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm font-medium truncate" title={m.member}>{m.member}</span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{m.entries} {m.entries === 1 ? 'entry' : 'entries'}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Income</p>
                      <p className="text-sm font-medium text-emerald-600">{formatBase(Number(m.income_total))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Expenses</p>
                      <p className="text-sm font-medium text-gray-700">{formatBase(Number(m.expense_total))}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase text-gray-400">Net</p>
                      <p className={`text-sm font-semibold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatBase(net)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, vendor, receipt #, card / reference…"
            className="w-full pl-9 pr-9 py-2 border rounded-lg bg-white"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => updateParam('status', e.target.value)}
          className="px-3 py-2 border rounded-lg bg-white"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => updateParam('expense_category', e.target.value)}
          className="px-3 py-2 border rounded-lg bg-white"
        >
          <option value="">All Categories</option>
          {EXPENSE_CATEGORIES.map(cat => (
            <option key={cat.value} value={cat.value}>{cat.label}</option>
          ))}
        </select>
        <select
          value={projectFilter}
          onChange={(e) => updateParam('project', e.target.value)}
          className="px-3 py-2 border rounded-lg bg-white"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.project} value={p.project}>{p.project}</option>
          ))}
        </select>
      </div>

      {/* Entry Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold">
                {editingEntry ? 'Edit Entry' : 'New Entry'}
              </h2>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Title *
                  </label>
                  <input
                    {...register('title')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Office supplies from Staples"
                  />
                  {errors.title && (
                    <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category *
                  </label>
                  <select
                    {...register('expense_category')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    {EXPENSE_CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expense Date *
                  </label>
                  <input
                    type="date"
                    {...register('expense_date')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  {errors.expense_date && (
                    <p className="text-red-500 text-sm mt-1">{errors.expense_date.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vendor Name
                  </label>
                  <input
                    {...register('vendor_name')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Staples, Amazon"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Receipt Number
                  </label>
                  <input
                    {...register('receipt_number')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Invoice or receipt #"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    {...register('description')}
                    rows={2}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Additional details about the expense..."
                  />
                </div>

                <div className="md:col-span-2 border-t pt-4">
                  <h3 className="font-medium text-gray-900 mb-3">Amounts & Taxes</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Subtotal (before tax)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        {...register('subtotal')}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        GST Rate
                      </label>
                      <select
                        {...register('gst_rate')}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">No GST</option>
                        <option value="0.05">5% GST</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        PST Rate
                      </label>
                      <select
                        {...register('pst_rate')}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">No PST</option>
                        <option value="0.07">7% PST (BC, MB)</option>
                        <option value="0.06">6% PST (SK)</option>
                        <option value="0.0975">9.975% QST (QC)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Other Sales Tax %
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        {...register('other_tax_percent')}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., 13"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Other Tax Description (optional)
                    </label>
                    <input
                      type="text"
                      {...register('other_tax_description')}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., HST (ON), VAT, State Tax"
                    />
                  </div>

                  {subtotal && subtotal > 0 && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span>Subtotal:</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                      {totals.gst > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>GST ({((gstRate || 0) * 100).toFixed(0)}%):</span>
                          <span>{formatCurrency(totals.gst)}</span>
                        </div>
                      )}
                      {totals.pst > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>PST ({((pstRate || 0) * 100).toFixed(2)}%):</span>
                          <span>{formatCurrency(totals.pst)}</span>
                        </div>
                      )}
                      {totals.otherTax > 0 && (
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>{watch('other_tax_description') || 'Other Tax'} ({otherTaxPercent || 0}%):</span>
                          <span>{formatCurrency(totals.otherTax)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-medium text-lg border-t mt-2 pt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(totals.total)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    {...register('payment_method')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="debit_card">Debit Card</option>
                    <option value="cash">Cash</option>
                    <option value="etransfer">E-Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Card / Payment Reference
                  </label>
                  <input
                    type="text"
                    {...register('payment_reference')}
                    placeholder="e.g. card ****2702"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Card last-4 or reference number — searchable later.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Project
                  </label>
                  <input
                    type="text"
                    {...register('project_code')}
                    placeholder="e.g. Nova X"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Optional — allocate this entry to a project.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Allocated to
                  </label>
                  <select
                    {...register('payee_user_id')}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">— Unassigned —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.email ? ` (${u.email})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Who this expense is allocated to / reimbursed.</p>
                </div>

                <div className="flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      {...register('is_reimbursable')}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <span className="text-sm text-gray-700">Reimbursable expense</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingEntry(null);
                    reset();
                  }}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : editingEntry ? 'Update' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Entry Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="p-6 border-b flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold">{selectedEntry.title}</h2>
                <span className={`inline-block px-2 py-1 text-xs rounded-full mt-2 ${STATUS_COLORS[selectedEntry.status]}`}>
                  {selectedEntry.status}
                </span>
              </div>
              <button onClick={() => setSelectedEntry(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-6 w-6" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Category:</span>
                  <p className="font-medium">{EXPENSE_CATEGORIES.find(c => c.value === selectedEntry.expense_category)?.label}</p>
                </div>
                <div>
                  <span className="text-gray-500">Date:</span>
                  <p className="font-medium">{formatDate(selectedEntry.expense_date)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Vendor:</span>
                  <p className="font-medium">{selectedEntry.vendor_name || '-'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Receipt #:</span>
                  <p className="font-medium">{selectedEntry.receipt_number || '-'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Subtotal:</span>
                  <p className="font-medium">{formatCurrency(selectedEntry.subtotal)}</p>
                </div>
                <div>
                  <span className="text-gray-500">Tax:</span>
                  <p className="font-medium">{formatCurrency(selectedEntry.tax_total)}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Total:</span>
                  <p className="text-xl font-bold text-blue-600">{formatCurrency(selectedEntry.total_with_tax)}</p>
                </div>
                {selectedEntry.source === 'email' && (
                  <div className="col-span-2 flex items-center gap-2 text-blue-600">
                    <Mail className="h-4 w-4" />
                    <span className="text-sm">Submitted via email</span>
                  </div>
                )}
              </div>
              {selectedEntry.description && (
                <div>
                  <span className="text-gray-500 text-sm">Description:</span>
                  <p className="mt-1">{selectedEntry.description}</p>
                </div>
              )}
              {selectedEntry.rejection_reason && (
                <div className="bg-red-50 p-3 rounded-lg">
                  <span className="text-red-700 text-sm font-medium">Rejection Reason:</span>
                  <p className="text-red-600 mt-1">{selectedEntry.rejection_reason}</p>
                </div>
              )}
              <div className="text-xs text-gray-400">
                Submitted by {selectedEntry.user_name} on {formatDate(selectedEntry.created_at)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Entries Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <button
                    type="button"
                    onClick={() => toggleSort('date')}
                    className="inline-flex items-center gap-1 uppercase hover:text-gray-700"
                  >
                    Date
                    {sortField === 'date' && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Currency</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  <button
                    type="button"
                    onClick={() => toggleSort('amount')}
                    className="inline-flex items-center gap-1 uppercase hover:text-gray-700 ml-auto"
                  >
                    {baseCurrency}
                    {sortField === 'amount' && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Original</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                    No entries found. Click "New Entry" to add one.
                  </td>
                </tr>
              ) : (
                sortedEntries.map((entry) => {
                  const amount = entry.total_with_tax || entry.subtotal || 0;
                  // Primary = base-currency amount (stored). Secondary = the raw
                  // foreign amount it was billed in, shown only when different.
                  const baseFormatted = formatBase(amount);
                  const originalRef = formatOriginalRef(
                    entry.original_amount ?? amount,
                    entry.original_currency
                  );
                  return (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{formatDate(entry.expense_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {entry.source === 'email' && <Mail className="h-4 w-4 text-blue-500" />}
                        <Link
                          to={`/ledger/${entry.id}`}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {entry.title}
                        </Link>
                      </div>
                      <span className="text-xs text-gray-500">{entry.user_name}</span>
                      {entry.project_code && (
                        <span className="text-xs text-gray-500"> · {entry.project_code}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {EXPENSE_CATEGORIES.find(c => c.value === entry.expense_category)?.label}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{entry.vendor_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-center">
                      <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">
                        {entry.original_currency || baseCurrency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                      {baseFormatted}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-500">
                      {originalRef || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-1 text-xs rounded-full ${STATUS_COLORS[entry.status]}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Link
                          to={`/ledger/${entry.id}`}
                          className="p-1 hover:bg-gray-100 rounded inline-block"
                          title="View details"
                        >
                          <Eye className="h-4 w-4 text-gray-500" />
                        </Link>

                        {(entry.user_id === user?.id || user?.role === 'admin') &&
                         ['draft', 'pending', 'rejected'].includes(entry.status) && (
                          <>
                            <button
                              onClick={() => handleEdit(entry)}
                              className="p-1 hover:bg-gray-100 rounded"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4 text-blue-500" />
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="p-1 hover:bg-gray-100 rounded"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </button>
                          </>
                        )}

                        {user?.role === 'admin' && entry.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleApprove(entry.id, 'approve')}
                              className="p-1 hover:bg-green-100 rounded"
                              title="Approve"
                            >
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </button>
                            <button
                              onClick={() => handleApprove(entry.id, 'reject')}
                              className="p-1 hover:bg-red-100 rounded"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4 text-red-500" />
                            </button>
                          </>
                        )}

                        {user?.role === 'admin' && entry.status === 'approved' && (
                          <button
                            onClick={() => handleMarkPaid(entry.id)}
                            className="p-1 hover:bg-purple-100 rounded"
                            title="Mark as paid"
                          >
                            <CreditCard className="h-4 w-4 text-purple-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LedgerPage;
