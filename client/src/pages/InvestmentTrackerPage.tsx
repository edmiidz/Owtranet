import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Plus, 
  DollarSign, 
  Calendar, 
  User, 
  Tag,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  Upload,
  Loader,
  FileImage,
  File,
  Sparkles
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { usersApi } from '../utils/api';

const deliverableSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(255, 'Title cannot exceed 255 characters'),
  content: z
    .string()
    .max(10000, 'Content cannot exceed 10,000 characters')
    .optional()
    .or(z.literal(''))
    .refine(
      (val) => !val || val.length === 0 || val.length >= 10,
      { message: 'Content must be at least 10 characters if provided' }
    ),
  amount: z
    .number()
    .min(0, 'Amount must be positive')
    .optional(),
  original_amount: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    },
    z.number().min(0, 'Original amount must be positive').optional()
  ),
  original_currency: z
    .string()
    .optional(),
  exchange_rate: z
    .number()
    .min(0.01, 'Exchange rate must be positive')
    .optional(),
  risk_multiplier: z
    .number()
    .min(0.1, 'Risk multiplier must be at least 0.1')
    .max(10, 'Risk multiplier cannot exceed 10')
    .optional(),
  investment_category: z
    .enum(['cash', 'sweat_equity', 'property', 'referral'])
    .default('cash'),
  nominee_user_id: z
    .number()
    .optional(),
  deliverable_date: z
    .string()
    .optional(),
  tags: z
    .string()
    .optional()
});

type DeliverableFormData = z.infer<typeof deliverableSchema>;

const InvestmentTrackerPage: React.FC = () => {
  const { user: currentUser } = useAuthStore();
  const baseCurrency = useBrandingStore((s) => s.baseCurrency);
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [theoreticalValue, setTheoreticalValue] = useState<number>(0);
  const [multipliers, setMultipliers] = useState({ cash: 2.8, sweat_equity: 2.0, property: 1.0, referral: 1.0 });
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'investments' | 'payments' | 'contributions'>('investments');
  const [contributions, setContributions] = useState<{
    members: Array<{ id: number; name: string; email: string; total_reported: number; total_approved: number; reported_count: number; approved_count: number; percentage: number }>;
    total_approved: number;
    total_reported: number;
  }>({ members: [], total_approved: 0, total_reported: 0 });
  const [statistics, setStatistics] = useState({
    total_theoretical_value: 0,
    total_expenses: 0,
    projected_theoretical_value: 0,
    pending_theoretical_value: 0,
    estimated_referral_value: 0
  });

  // Predefined tag suggestions
  // Tag definitions with colors
  const tagDefinitions = {
    cash: [
      { name: 'Deferred Commission', color: '#10B981' }
    ],
    sweat_equity: [
      { name: 'Development', color: '#EF4444' },
      { name: 'Marketing', color: '#EC4899' },
      { name: 'Sales', color: '#10B981' },
      { name: 'Management', color: '#6366F1' },
      { name: 'Design', color: '#8B5CF6' }
    ],
    property: [
      { name: 'IP', color: '#3B82F6' },
      { name: 'Vehicle', color: '#F59E0B' },
      { name: 'Equipment', color: '#10B981' },
      { name: 'Real Estate', color: '#8B5CF6' },
      { name: 'Software', color: '#6366F1' },
      { name: 'Hardware', color: '#EF4444' }
    ],
    referral: [
      { name: 'Investor Referral', color: '#3B82F6' },
      { name: 'Partner Referral', color: '#8B5CF6' },
      { name: 'Employee-Contractor Referral', color: '#F59E0B' },
      { name: 'Customer Referral', color: '#10B981' }
    ]
  };

  const getTagColor = (tagName: string) => {
    for (const category of Object.values(tagDefinitions)) {
      const tag = category.find(t => t.name === tagName);
      if (tag) return tag.color;
    }
    return '#6B7280'; // Default gray
  };

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<DeliverableFormData>({
    resolver: zodResolver(deliverableSchema),
    defaultValues: {
      nominee_user_id: currentUser?.id,
      deliverable_date: new Date().toISOString().split('T')[0],
      investment_category: 'cash',
      original_currency: baseCurrency,
      exchange_rate: 1.0
    }
  });

  const watchedContent = watch('content', '');
  const watchedOriginalAmount = watch('original_amount');
  const watchedExchangeRate = watch('exchange_rate');
  const watchedRiskMultiplier = watch('risk_multiplier');
  const watchedCategory = watch('investment_category');
  const watchedCurrency = watch('original_currency');
  const watchedDate = watch('deliverable_date');

  // Calculate theoretical value in real-time
  const calculateTheoreticalValue = useCallback(() => {
    const amount = Number(watchedOriginalAmount) || 0;
    const rate = Number(watchedExchangeRate) || 1;
    const risk = Number(watchedRiskMultiplier) || 1;
    return Math.round(amount * rate * risk * 100) / 100;
  }, [watchedOriginalAmount, watchedExchangeRate, watchedRiskMultiplier]);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  // Update theoretical value when investment fields change
  useEffect(() => {
    setTheoreticalValue(calculateTheoreticalValue());
  }, [calculateTheoreticalValue]);

  // Auto-update risk multiplier when category changes
  useEffect(() => {
    if (watchedCategory) {
      const categoryMultiplier = multipliers[watchedCategory as keyof typeof multipliers];
      setValue('risk_multiplier', categoryMultiplier);
    }
  }, [watchedCategory, multipliers, setValue]);

  // Auto-fetch exchange rate when currency or date changes
  useEffect(() => {
    const fetchExchangeRate = async () => {
      if (!watchedCurrency || watchedCurrency === baseCurrency) {
        setValue('exchange_rate', 1.0);
        return;
      }

      if (!watchedDate) return;

      try {
        const response = await fetch(`/api/exchange-rates?date=${watchedDate}&currency=${watchedCurrency}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setValue('exchange_rate', data.rate);
        }
      } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
      }
    };

    fetchExchangeRate();
  }, [watchedCurrency, watchedDate, setValue, baseCurrency]);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Load users for nominee dropdown
      const userData = await usersApi.getUsers();
      setUsers(userData.filter((user: any) => user.role !== 'deactivated'));

      // Load multipliers
      const multipliersResponse = await fetch('/api/investment-settings/multipliers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (multipliersResponse.ok) {
        const multipliersData = await multipliersResponse.json();
        setMultipliers(multipliersData);
      }

      // Load deliverables
      const deliverableResponse = await fetch('/api/deliverables', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (deliverableResponse.ok) {
        const deliverableData = await deliverableResponse.json();
        // Separate investments from payments
        const investments = deliverableData.filter((d: any) => d.type !== 'member_payment');
        const paymentRecords = deliverableData.filter((d: any) => d.type === 'member_payment');
        setDeliverables(investments);
        setPayments(paymentRecords);
      }

      // Load investment statistics
      const statisticsResponse = await fetch('/api/investment-tracker/statistics', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (statisticsResponse.ok) {
        const statisticsData = await statisticsResponse.json();
        setStatistics(statisticsData);
      }

      // Load per-member contributions (powers the Contributions tab)
      const contributionsResponse = await fetch('/api/investment-tracker/contributions', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });
      if (contributionsResponse.ok) {
        const contributionsData = await contributionsResponse.json();
        setContributions(contributionsData);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Failed to load investment tracker data');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: DeliverableFormData) => {
    try {
      setError('');
      setSuccess('');
      setIsSubmitting(true);

      // Parse tags
      const tags = data.tags 
        ? data.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
        : [];

      const response = await fetch('/api/deliverables', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: data.title,
          content: data.content,
          amount: data.amount,
          original_amount: data.original_amount,
          original_currency: data.original_currency,
          exchange_rate: data.exchange_rate,
          risk_multiplier: data.risk_multiplier,
          investment_category: data.investment_category,
          nominee_user_id: data.nominee_user_id,
          deliverable_date: data.deliverable_date,
          tags
        })
      });

      if (response.ok) {
        setSuccess('Deliverable submitted successfully! Admins have been notified for review.');
        reset();
        setShowForm(false);
        loadData(); // Reload deliverables
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to submit deliverable');
      }
    } catch (err: any) {
      setError('Failed to submit deliverable. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // File upload and analysis functions
  const handleFileUpload = async (file: File) => {
    try {
      setError('');
      setIsAnalyzing(true);
      setUploadedFile(file);

      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/deliverables/analyze-document', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result.analysis);
        
        // Pre-fill form fields with AI suggestions including investment calculations
        if (result.analysis.suggestedTitle) {
          let enhancedTitle = result.analysis.suggestedTitle;
          let enhancedContent = result.analysis.extractedText || result.analysis.description || '';
          
          reset({
            ...watch(),
            title: enhancedTitle,
            content: enhancedContent,
            original_amount: result.analysis.suggestedAmount || undefined,
            original_currency: result.analysis.currency || baseCurrency,
            exchange_rate: result.analysis.suggestedExchangeRate || 1.0,
            risk_multiplier: result.analysis.suggestedRiskMultiplier || 2.8,
            tags: result.analysis.tags?.join(', ') || ''
          });
        }
        
        setSuccess('Document analyzed successfully! Review and edit the suggested fields below.');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to analyze document');
      }
    } catch (err) {
      setError('Failed to upload and analyze document');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFileUpload(files[0]);
    }
  };

  const clearFile = () => {
    setUploadedFile(null);
    setAnalysisResult(null);
    setError('');
    setSuccess('');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Investment Tracker</h1>
          <p className="text-gray-600">Submit and track deliverables, expenses, and business contributions</p>
        </div>
        <div className="flex space-x-2">
          {currentUser?.role === 'admin' && (
            <Link
              to="/investment-tracker/payments"
              className="btn btn-secondary"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Manage Payments
            </Link>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn btn-primary"
          >
            <Plus className="h-4 w-4 mr-2" />
            {showForm ? 'Cancel' : 'New Deliverable'}
          </button>
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

      {/* Investment Statistics Dashboard */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Investment Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              ${statistics.total_theoretical_value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-600">Total Theoretical Value</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              ${statistics.projected_theoretical_value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-600">Projected Theoretical Value</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              ${statistics.total_expenses.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-gray-600">Total Expenses to Date</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('investments')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'investments'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Investments ({deliverables.length})
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'payments'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Payments ({payments.length})
          </button>
          <button
            onClick={() => setActiveTab('contributions')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'contributions'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Contributions ({contributions.members.length})
          </button>
        </nav>
      </div>

      {/* Submission Form */}
      {showForm && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Submit New Deliverable</h2>
          
          {/* File Upload Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Upload Document (Optional)</h3>
              <span className="text-sm text-blue-600 flex items-center">
                <Sparkles className="h-4 w-4 mr-1" />
                AI-Powered Analysis
              </span>
            </div>
            
            {!uploadedFile ? (
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="document-upload"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleFileSelect}
                  disabled={isAnalyzing}
                />
                
                {isAnalyzing ? (
                  <div className="space-y-4">
                    <Loader className="h-12 w-12 text-blue-500 mx-auto animate-spin" />
                    <div>
                      <p className="text-lg font-medium text-gray-700">Analyzing Document...</p>
                      <p className="text-sm text-gray-500">AI is extracting information from your document</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-center">
                      <Upload className="h-12 w-12 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-lg font-medium text-gray-700">Upload a receipt, invoice, or document</p>
                      <p className="text-sm text-gray-500">Drag and drop or click to browse</p>
                      <p className="text-xs text-gray-400 mt-2">Supports JPG, PNG, PDF (max 10MB)</p>
                    </div>
                    <label
                      htmlFor="document-upload"
                      className="btn btn-secondary cursor-pointer inline-flex items-center"
                    >
                      <FileImage className="h-4 w-4 mr-2" />
                      Choose File
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-gray-300 rounded-lg p-6 bg-gray-50">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    {uploadedFile.type.includes('pdf') ? (
                      <File className="h-8 w-8 text-red-500" />
                    ) : (
                      <FileImage className="h-8 w-8 text-blue-500" />
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                      <p className="text-sm text-gray-500">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
                
                {analysisResult && (
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center mb-3">
                      <Sparkles className="h-5 w-5 text-blue-500 mr-2" />
                      <span className="font-medium text-gray-900">AI Analysis Results</span>
                      <span className={`ml-auto px-2 py-1 rounded-full text-xs ${
                        analysisResult.confidence > 0.7 
                          ? 'bg-green-100 text-green-800' 
                          : analysisResult.confidence > 0.4
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {Math.round(analysisResult.confidence * 100)}% Confidence
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <span className="ml-2 font-medium">{analysisResult.type || 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Category:</span>
                        <span className="ml-2 font-medium">{analysisResult.category || 'Unknown'}</span>
                      </div>
                      {analysisResult.suggestedAmount && (
                        <div>
                          <span className="text-gray-500">Amount:</span>
                          <span className="ml-2 font-medium">
                            {analysisResult.currency === 'CAD' ? 'C$' : 
                             analysisResult.currency === 'EUR' ? '€' :
                             analysisResult.currency === 'GBP' ? '£' : '$'}
                            {analysisResult.suggestedAmount}
                            {analysisResult.currency && analysisResult.currency !== baseCurrency && (
                              <span className="ml-1 text-xs text-gray-400">({analysisResult.currency})</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {analysisResult.description && (
                      <div className="mt-3">
                        <p className="text-sm text-gray-600">{analysisResult.description}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Analysis Loading State */}
          {isAnalyzing && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
              <div className="space-y-4">
                <div className="flex justify-center">
                  <Loader className="h-16 w-16 text-blue-500 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-blue-900">Analyzing Your Document</h3>
                  <p className="text-blue-700 mt-2">AI is extracting information from your receipt...</p>
                  <p className="text-blue-600 text-sm mt-1">This may take a few seconds</p>
                </div>
              </div>
            </div>
          )}

          {/* Form - Hidden During Analysis */}
          {!isAnalyzing && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Title */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title *
                </label>
                <input
                  {...register('title')}
                  type="text"
                  className="form-input"
                  placeholder="Brief description of the deliverable"
                />
                {errors.title && (
                  <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
                )}
              </div>

              {/* Original Amount & Currency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Original Amount & Currency (Optional)
                </label>
                <div className="flex space-x-2">
                  <div className="flex-1 relative">
                    <input
                      {...register('original_amount')}
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input"
                      placeholder="32.39"
                    />
                  </div>
                  <select
                    {...register('original_currency')}
                    className="form-select w-24"
                  >
                    <option value="USD">USD</option>
                    <option value="CAD">CAD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                  </select>
                </div>
                {errors.original_amount && (
                  <p className="mt-1 text-sm text-red-600">{errors.original_amount.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">Leave blank if contribution size is unknown or not yet determined</p>
              </div>

              {/* Exchange Rate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Exchange Rate (to {baseCurrency})
                </label>
                <input
                  {...register('exchange_rate', { valueAsNumber: true })}
                  type="number"
                  step="0.000001"
                  min="0.01"
                  className="form-input bg-gray-50"
                  placeholder="1.0"
                  readOnly
                />
                {errors.exchange_rate && (
                  <p className="mt-1 text-sm text-red-600">{errors.exchange_rate.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Auto-populated based on currency and date. {baseCurrency} = 1.0
                </p>
              </div>

              {/* Investment Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Investment Category <span className="text-red-500">*</span>
                </label>
                <select
                  {...register('investment_category')}
                  className="form-select"
                >
                  <option value="cash">Cash (×{multipliers.cash})</option>
                  <option value="sweat_equity">Sweat Equity (×{multipliers.sweat_equity})</option>
                  <option value="property">Property (×{multipliers.property})</option>
                  <option value="referral">Referral (×{multipliers.referral})</option>
                </select>
                {errors.investment_category && (
                  <p className="mt-1 text-sm text-red-600">{errors.investment_category.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Category determines the risk multiplier. Use tags for granular classification.
                </p>
              </div>

              {/* Risk Multiplier */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Risk Multiplier
                </label>
                <input
                  {...register('risk_multiplier', { valueAsNumber: true })}
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  className="form-input bg-gray-50"
                  placeholder="2.8"
                />
                {errors.risk_multiplier && (
                  <p className="mt-1 text-sm text-red-600">{errors.risk_multiplier.message}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">Auto-set by category (admin can override)</p>
              </div>

              {/* Theoretical Value (Calculated) */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Theoretical Investment Value ({baseCurrency})
                </label>
                <div className="relative">
                  {theoreticalValue > 0 ? (
                    <>
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <DollarSign className="h-4 w-4 text-green-500" />
                      </div>
                      <input
                        type="text"
                        value={`$${theoreticalValue.toFixed(2)}`}
                        className="form-input pl-10 bg-green-50 border-green-200 text-green-800 font-semibold"
                        readOnly
                      />
                    </>
                  ) : (
                    <input
                      type="text"
                      value="Pending"
                      className="form-input bg-yellow-50 border-yellow-200 text-yellow-800 font-semibold text-center"
                      readOnly
                    />
                  )}
                </div>
                {theoreticalValue > 0 ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Calculated as: {Number(watchedOriginalAmount) || 0} × {Number(watchedExchangeRate) || 1} × {Number(watchedRiskMultiplier) || 1} = ${theoreticalValue.toFixed(2)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">
                    Enter an original amount to calculate theoretical value
                  </p>
                )}
              </div>

              {/* Nominee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nominee
                </label>
                <select
                  {...register('nominee_user_id', { valueAsNumber: true })}
                  className="form-select"
                >
                  <option value={currentUser?.id}>{currentUser?.name} (Me)</option>
                  {users
                    .filter(user => user.id !== currentUser?.id)
                    .map(user => (
                      <option key={user.id} value={user.id}>
                        {user.name}{(user.intranet_username || user.github_username) && ` (@${user.intranet_username || user.github_username})`}
                      </option>
                    ))
                  }
                </select>
                <p className="mt-1 text-xs text-gray-500">Who should receive credit for this deliverable</p>
              </div>

              {/* Deliverable Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Deliverable Date
                </label>
                <input
                  {...register('deliverable_date')}
                  type="date"
                  className="form-input"
                />
                <p className="mt-1 text-xs text-gray-500">When was this deliverable completed</p>
              </div>

              {/* Tags */}
              <div className="lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tags (Optional)
                </label>

                {/* Selected Tags Display */}
                {selectedTags.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <p className="text-xs text-gray-500">Selected Tags:</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedTags.map((tag) => {
                        const color = getTagColor(tag);
                        return (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium group"
                            style={{
                              backgroundColor: `${color}20`,
                              color: color
                            }}
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => {
                                const newTags = selectedTags.filter(t => t !== tag);
                                setSelectedTags(newTags);
                                setValue('tags', newTags.join(', '));
                              }}
                              className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <svg className="h-3 w-3 hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tag Suggestions Based on Category */}
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Suggested tags for {
                      watchedCategory === 'sweat_equity' ? 'Sweat Equity' :
                      watchedCategory === 'property' ? 'Property' :
                      watchedCategory === 'referral' ? 'Referral' :
                      'Cash'
                    }:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tagDefinitions[watchedCategory as keyof typeof tagDefinitions].map((tag) => (
                      <button
                        key={tag.name}
                        type="button"
                        onClick={() => {
                          if (!selectedTags.includes(tag.name)) {
                            const newTags = [...selectedTags, tag.name];
                            setSelectedTags(newTags);
                            setValue('tags', newTags.join(', '));
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: selectedTags.includes(tag.name) ? `${tag.color}40` : `${tag.color}20`,
                          color: tag.color,
                          cursor: selectedTags.includes(tag.name) ? 'not-allowed' : 'pointer'
                        }}
                        disabled={selectedTags.includes(tag.name)}
                      >
                        {!selectedTags.includes(tag.name) && (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual Tag Input */}
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                  <p className="text-xs text-gray-500">Or add a custom tag:</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Type custom tag..."
                      className="form-input flex-1 text-sm"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const input = e.currentTarget;
                          const customTag = input.value.trim();
                          if (customTag && !selectedTags.includes(customTag)) {
                            const newTags = [...selectedTags, customTag];
                            setSelectedTags(newTags);
                            setValue('tags', newTags.join(', '));
                            input.value = '';
                          }
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        const customTag = input.value.trim();
                        if (customTag && !selectedTags.includes(customTag)) {
                          const newTags = [...selectedTags, customTag];
                          setSelectedTags(newTags);
                          setValue('tags', newTags.join(', '));
                          input.value = '';
                        }
                      }}
                      className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Hidden input for form submission */}
                <input
                  {...register('tags')}
                  type="hidden"
                />
              </div>
            </div>

            {/* Content */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Description (Optional)
                </label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setPreviewMode(false)}
                    className={`px-3 py-1 rounded text-sm ${!previewMode ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(true)}
                    className={`px-3 py-1 rounded text-sm ${previewMode ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    <Eye className="h-4 w-4 mr-1 inline" />Preview
                  </button>
                </div>
              </div>
              
              {previewMode ? (
                <div className="min-h-32 p-4 border border-gray-300 rounded-lg bg-gray-50">
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>
                      {watchedContent || '*Write a description to see the preview...*'}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <textarea
                  {...register('content')}
                  rows={8}
                  className="form-input font-mono text-sm"
                  placeholder="Detailed description of the deliverable, work completed, or expense incurred..."
                />
              )}
              
              {errors.content && (
                <p className="mt-1 text-sm text-red-600">{errors.content.message}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">Supports Markdown formatting</p>
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Submit Deliverable
                  </>
                )}
              </button>
            </div>
          </form>
          )}
        </div>
      )}

      {/* Deliverables List */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Recent Deliverables</h2>
          <Link
            to="/search?type=investments"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
          >
            View All
            <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-24 bg-gray-300 rounded"></div>
              </div>
            ))}
          </div>
        ) : activeTab === 'investments' && deliverables.length > 0 ? (
          <div className="space-y-4">
            {deliverables.map((deliverable) => (
              <div
                key={deliverable.id}
                className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => navigate(`/investment-tracker/${deliverable.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      {getStatusIcon(deliverable.status)}
                      <h3 className="ml-2 font-medium text-gray-900 hover:text-blue-600 transition-colors">
                        {deliverable.title}
                      </h3>
                      {deliverable.theoretical_value_usd ? (
                        <span className="ml-3 px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">
                          ${Number(deliverable.theoretical_value_usd).toFixed(2)}
                        </span>
                      ) : deliverable.amount ? (
                        <span className="ml-3 px-2 py-1 bg-green-100 text-green-800 text-sm rounded-full">
                          ${deliverable.amount}
                        </span>
                      ) : (
                        <span className="ml-3 px-2 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full">
                          Value Pending
                        </span>
                      )}
                    </div>

                    <p className="text-gray-600 text-sm mb-2">
                      {deliverable.content?.substring(0, 150)}...
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-xs text-gray-500 space-x-3">
                        <span className="flex items-center">
                          <User className="h-3 w-3 mr-1" />
                          {deliverable.nominee_name || deliverable.user_name}
                        </span>
                        <span className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(deliverable.deliverable_date || deliverable.created_at).toLocaleDateString()}
                        </span>
                        {deliverable.tags && deliverable.tags.length > 0 && (
                          <span className="flex items-center">
                            <Tag className="h-3 w-3 mr-1" />
                            {deliverable.tags.map((tag: any) => tag.name).join(', ')}
                          </span>
                        )}
                      </div>

                      <Link
                        to={`/investment-tracker/${deliverable.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Details →
                      </Link>
                    </div>
                  </div>

                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ml-4 ${getStatusColor(deliverable.status)}`}>
                    {deliverable.status.charAt(0).toUpperCase() + deliverable.status.slice(1).replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'payments' && payments.length > 0 ? (
          <div className="space-y-4">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => navigate(`/investment-tracker/${payment.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <DollarSign className="h-5 w-5 text-blue-500" />
                      <h3 className="ml-2 font-medium text-gray-900 hover:text-blue-600 transition-colors">
                        {payment.title}
                      </h3>
                      <span className="ml-3 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                        ${payment.amount} × {payment.risk_multiplier}x = ${(payment.amount * payment.risk_multiplier).toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-xs text-gray-500 space-x-3">
                        <span className="flex items-center">
                          <User className="h-3 w-3 mr-1" />
                          From: {payment.user_name}
                        </span>
                        <span className="flex items-center">
                          <User className="h-3 w-3 mr-1" />
                          To: {payment.nominee_name}
                        </span>
                        <span className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(payment.deliverable_date || payment.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <Link
                        to={`/investment-tracker/${payment.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Details →
                      </Link>
                    </div>
                  </div>

                  <span className="px-3 py-1 rounded-full text-xs font-medium border ml-4 bg-green-100 text-green-900 border-green-300">
                    Paid
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'contributions' && contributions.members.length > 0 ? (
          <div className="space-y-6">
            {/* Pie + legend */}
            <div className="card p-6 flex flex-col md:flex-row items-center gap-8">
              {(() => {
                const palette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#0d9488'];
                const total = contributions.total_approved || 0;
                let acc = 0;
                const radius = 16; // for a 0..100 circumference trick
                const circ = 2 * Math.PI * radius;
                return (
                  <>
                    <svg viewBox="0 0 42 42" className="w-48 h-48 flex-shrink-0 -rotate-90">
                      <circle cx="21" cy="21" r={radius} fill="transparent" stroke="#e5e7eb" strokeWidth="6" />
                      {total > 0 && contributions.members.map((m, i) => {
                        const frac = m.total_approved / total;
                        if (frac <= 0) return null;
                        const dash = frac * circ;
                        const offset = -acc * circ;
                        acc += frac;
                        return (
                          <circle
                            key={m.id}
                            cx="21" cy="21" r={radius} fill="transparent"
                            stroke={palette[i % palette.length]} strokeWidth="6"
                            strokeDasharray={`${dash} ${circ - dash}`}
                            strokeDashoffset={offset}
                          />
                        );
                      })}
                    </svg>
                    <div className="flex-1 w-full">
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Approved contributions by member</h3>
                      <p className="text-2xl font-semibold text-gray-900 mb-4">${total.toLocaleString()}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {contributions.members.map((m, i) => (
                          <div key={m.id} className="flex items-center text-sm">
                            <span className="inline-block w-3 h-3 rounded-sm mr-2 flex-shrink-0" style={{ backgroundColor: palette[i % palette.length] }} />
                            <span className="text-gray-700 truncate">{m.name}</span>
                            <span className="ml-auto text-gray-500">{m.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Per-member table */}
            <div className="card overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Member</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Reported</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Approved</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">%</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {contributions.members.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center text-sm font-medium text-gray-900">
                          <User className="h-4 w-4 mr-2 text-gray-400" />
                          {m.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-600">
                        ${m.total_reported.toLocaleString()}
                        <span className="text-gray-400 text-xs ml-1">({m.reported_count})</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium text-green-700">
                        ${m.total_approved.toLocaleString()}
                        <span className="text-gray-400 text-xs ml-1">({m.approved_count})</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm text-gray-900">{m.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">${contributions.total_reported.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">${contributions.total_approved.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg">
              {activeTab === 'investments' ? 'No deliverables submitted yet'
                : activeTab === 'contributions' ? 'No contributions yet'
                : 'No payments recorded yet'}
            </p>
            <p className="text-gray-500 text-sm">
              {activeTab === 'investments' ? 'Submit your first deliverable to get started!'
                : activeTab === 'contributions' ? 'Approved deliverables will show up here, grouped by member.'
                : 'Payments will appear here when recorded.'}
            </p>
            {activeTab === 'investments' && (
              <button
                onClick={() => setShowForm(true)}
                className="btn btn-primary mt-4"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create First Deliverable
              </button>
            )}
          </div>
        )}
      </div>

      {/* API Information */}
      <div className="card p-6 bg-blue-50 border-blue-200">
        <h3 className="text-lg font-medium text-blue-900 mb-2">API Integration Available</h3>
        <p className="text-blue-800 text-sm">
          Deliverables can also be submitted programmatically via our API.
          Check the forum for complete integration documentation and examples.
        </p>
      </div>
    </div>
  );
};

export default InvestmentTrackerPage;