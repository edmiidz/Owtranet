import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Loader,
  PieChart,
  Users,
  Plus,
  DollarSign,
  ArrowRight,
  Pencil,
  Trash2
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { usersApi } from '../utils/api';

interface MemberPayment {
  id: number;
  payer_name: string;
  recipient_name: string;
  amount: number;
  original_amount: number;
  original_currency: string;
  exchange_rate: number;
  risk_multiplier: number;
  theoretical_value_usd: number;
  deliverable_date: string;
  notes: string;
  created_at: string;
}

const PaymentManagementPage: React.FC = () => {
  const { user: currentUser } = useAuthStore();
  const { companyName, baseCurrency } = useBrandingStore();
  const [payments, setPayments] = useState<MemberPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Investment shares
  const [investmentShares, setInvestmentShares] = useState<any[]>([]);
  const [totalInvestment, setTotalInvestment] = useState<number>(0);
  const [showInvestmentShares, setShowInvestmentShares] = useState(true);

  // Member payment modal
  const [showMemberPaymentModal, setShowMemberPaymentModal] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [memberPaymentData, setMemberPaymentData] = useState({
    payer_id: 0,
    recipient_id: 0,
    amount: '',
    currency: baseCurrency,
    exchange_rate: '1.0',
    payment_date: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    if (currentUser?.role !== 'admin') {
      setError('Admin access required');
      return;
    }
    loadPayments();
    loadInvestmentShares();
    loadUsers();
  }, [currentUser]);

  const loadPayments = async () => {
    try {
      setIsLoading(true);
      setError('');

      const response = await fetch('/api/deliverables', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Filter for member_payment type only
        const paymentData = data
          .filter((d: any) => d.type === 'member_payment')
          .map((d: any) => ({
            id: d.id,
            payer_name: d.user_name,
            recipient_name: d.nominee_name,
            amount: d.amount || 0,
            original_amount: d.original_amount || d.amount || 0,
            original_currency: d.original_currency || baseCurrency,
            exchange_rate: d.exchange_rate || 1.0,
            risk_multiplier: d.risk_multiplier || 1.0,
            theoretical_value_usd: d.theoretical_value_usd || (d.amount * (d.risk_multiplier || 1.0)),
            deliverable_date: d.deliverable_date,
            notes: d.content,
            created_at: d.created_at
          }));
        setPayments(paymentData);
      } else {
        setError('Failed to load payments');
      }
    } catch (err) {
      console.error('Failed to load payments:', err);
      setError('Failed to load payments');
    } finally {
      setIsLoading(false);
    }
  };

  const loadInvestmentShares = async () => {
    try {
      const response = await fetch('/api/deliverables/investment-shares', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setInvestmentShares(data.shares);
        setTotalInvestment(data.total_investment);
      }
    } catch (err) {
      console.error('Failed to load investment shares:', err);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await usersApi.getUsers();
      setUsers(data.filter((u: any) => u.role !== 'deactivated'));
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const fetchExchangeRate = async (date: string, currency: string) => {
    if (currency === baseCurrency) {
      setMemberPaymentData(prev => ({ ...prev, exchange_rate: '1.0' }));
      return;
    }

    try {
      const response = await fetch(`/api/exchange-rates?date=${date}&currency=${currency}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setMemberPaymentData(prev => ({ ...prev, exchange_rate: data.rate.toString() }));
      }
    } catch (err) {
      console.error('Failed to fetch exchange rate:', err);
    }
  };

  const createMemberPayment = async () => {
    try {
      setIsProcessing(true);
      setError('');

      const response = await fetch('/api/deliverables/member-payment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payer_id: memberPaymentData.payer_id,
          recipient_id: memberPaymentData.recipient_id,
          amount: parseFloat(memberPaymentData.amount),
          currency: memberPaymentData.currency,
          exchange_rate: parseFloat(memberPaymentData.exchange_rate),
          payment_date: memberPaymentData.payment_date,
          notes: memberPaymentData.notes
        })
      });

      if (response.ok) {
        const result = await response.json();
        setSuccess(`Payment recorded successfully!${result.created_investment ? ' Investment entry also created.' : ''}`);
        setShowMemberPaymentModal(false);
        setMemberPaymentData({
          payer_id: 0,
          recipient_id: 0,
          amount: '',
          currency: baseCurrency,
          exchange_rate: '1.0',
          payment_date: new Date().toISOString().split('T')[0],
          notes: ''
        });
        loadPayments();
        loadInvestmentShares();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to record member payment');
      }
    } catch (err) {
      setError('Failed to record member payment. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const updateMemberPayment = async () => {
    if (!editingPaymentId) return;

    try {
      setIsProcessing(true);
      setError('');

      const response = await fetch(`/api/deliverables/member-payment/${editingPaymentId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payer_id: memberPaymentData.payer_id,
          recipient_id: memberPaymentData.recipient_id,
          amount: parseFloat(memberPaymentData.amount),
          currency: memberPaymentData.currency,
          exchange_rate: parseFloat(memberPaymentData.exchange_rate),
          payment_date: memberPaymentData.payment_date,
          notes: memberPaymentData.notes
        })
      });

      if (response.ok) {
        setSuccess('Payment updated successfully!');
        setShowMemberPaymentModal(false);
        setEditingPaymentId(null);
        setMemberPaymentData({
          payer_id: 0,
          recipient_id: 0,
          amount: '',
          currency: baseCurrency,
          exchange_rate: '1.0',
          payment_date: new Date().toISOString().split('T')[0],
          notes: ''
        });
        loadPayments();
        loadInvestmentShares();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update member payment');
      }
    } catch (err) {
      setError('Failed to update member payment. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteMemberPayment = async (paymentId: number) => {
    if (!confirm('Are you sure you want to delete this payment record? This action cannot be undone.')) {
      return;
    }

    try {
      setError('');
      const response = await fetch(`/api/deliverables/${paymentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
        }
      });

      if (response.ok) {
        setSuccess('Payment deleted successfully!');
        loadPayments();
        loadInvestmentShares();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to delete payment');
      }
    } catch (err) {
      setError('Failed to delete payment. Please try again.');
    }
  };

  const handleEditPayment = (payment: MemberPayment) => {
    // Find the payer and recipient user IDs
    const payer = users.find(u => u.name === payment.payer_name);
    const recipient = users.find(u => u.name === payment.recipient_name);

    setEditingPaymentId(payment.id);
    setMemberPaymentData({
      payer_id: payer?.id || 0,
      recipient_id: recipient?.id || 0,
      amount: payment.original_amount.toString(),
      currency: payment.original_currency,
      exchange_rate: payment.exchange_rate.toString(),
      payment_date: new Date(payment.deliverable_date).toISOString().split('T')[0],
      notes: payment.notes || ''
    });
    setShowMemberPaymentModal(true);
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600 mb-4">Admin access required for payment management</p>
        <Link to="/investment-tracker" className="btn btn-primary">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Investment Tracker
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/investment-tracker"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Payment Ledger</h1>
            <p className="text-gray-600">Member-to-member payment records</p>
          </div>
        </div>
        <button
          onClick={() => setShowMemberPaymentModal(true)}
          className="btn btn-primary"
        >
          <Plus className="h-4 w-4 mr-2" />
          Record Payment
        </button>
      </div>

      {/* Messages */}
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

      {/* Investment Shares Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <PieChart className="h-5 w-5 text-blue-600 mr-2" />
              <h2 className="text-lg font-semibold text-gray-900">Investment Shares ({baseCurrency} Value)</h2>
            </div>
            <button
              onClick={() => setShowInvestmentShares(!showInvestmentShares)}
              className="btn btn-secondary"
            >
              {showInvestmentShares ? 'Hide' : 'Show'} Details
            </button>
          </div>
        </div>

        {showInvestmentShares && (
          <div className="p-6">
            <div className="mb-4">
              <p className="text-sm text-gray-600">
                Total Investment Value: <span className="font-bold text-lg text-blue-600">${totalInvestment.toFixed(2)} {baseCurrency}</span>
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Member
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Investment Value ({baseCurrency})
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Share %
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deliverables
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payments Made/Received
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {investmentShares.map((share) => (
                    <tr key={share.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{share.name}</p>
                          <p className="text-xs text-gray-500">{share.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-blue-600">
                        ${share.total_investment_usd.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${share.percentage}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">{share.percentage}%</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {share.deliverable_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {share.payments_made} / {share.payments_received}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Payment Ledger */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Payment History</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
            <p className="text-gray-600 mt-2">Loading payments...</p>
          </div>
        ) : payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payer → Recipient
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Original Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Theoretical Value ({baseCurrency})
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Notes
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(payment.deliverable_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm">
                        <span className="font-medium text-gray-900">{payment.payer_name}</span>
                        <ArrowRight className="h-4 w-4 mx-2 text-gray-400" />
                        <span className="font-medium text-gray-900">{payment.recipient_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.original_currency} {Number(payment.original_amount || 0).toFixed(2)}
                      {payment.original_currency !== baseCurrency && payment.exchange_rate && (
                        <span className="text-xs text-gray-500 ml-1">
                          (@ {Number(payment.exchange_rate).toFixed(4)})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">
                      ${Number(payment.theoretical_value_usd || 0).toFixed(2)}
                      {payment.risk_multiplier && payment.risk_multiplier !== 1 && (
                        <span className="text-xs text-gray-500 ml-1">
                          (×{Number(payment.risk_multiplier).toFixed(1)})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {payment.notes || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEditPayment(payment)}
                          className="text-blue-600 hover:text-blue-800 transition-colors"
                          title="Edit payment"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteMemberPayment(payment.id)}
                          className="text-red-600 hover:text-red-800 transition-colors"
                          title="Delete payment"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No payments recorded yet</p>
          </div>
        )}
      </div>

      {/* Member Payment Modal */}
      {showMemberPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="h-5 w-5 mr-2" />
              {editingPaymentId ? 'Edit Payment' : 'Record Member Payment'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payer (Investor)
                </label>
                <select
                  value={memberPaymentData.payer_id}
                  onChange={(e) => setMemberPaymentData({ ...memberPaymentData, payer_id: parseInt(e.target.value) })}
                  className="form-select w-full"
                >
                  <option value={0}>Select payer...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">{`Person making the payment (increases their investment unless ${companyName})`}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Recipient (Payee)
                </label>
                <select
                  value={memberPaymentData.recipient_id}
                  onChange={(e) => setMemberPaymentData({ ...memberPaymentData, recipient_id: parseInt(e.target.value) })}
                  className="form-select w-full"
                >
                  <option value={0}>Select recipient...</option>
                  {users.filter(u => u.role !== 'system').map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Person receiving the payment</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Amount
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={memberPaymentData.amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow numbers and decimal point
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setMemberPaymentData({ ...memberPaymentData, amount: value });
                      }
                    }}
                    className="form-input w-full"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Currency
                  </label>
                  <select
                    value={memberPaymentData.currency}
                    onChange={(e) => {
                      const newCurrency = e.target.value;
                      setMemberPaymentData({ ...memberPaymentData, currency: newCurrency });
                      fetchExchangeRate(memberPaymentData.payment_date, newCurrency);
                    }}
                    className="form-select w-full"
                  >
                    <option value="USD">USD</option>
                    <option value="CAD">CAD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                  </select>
                </div>
              </div>

              {memberPaymentData.currency !== baseCurrency && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Exchange Rate (to {baseCurrency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={memberPaymentData.exchange_rate}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow numbers and decimal point
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setMemberPaymentData({ ...memberPaymentData, exchange_rate: value });
                      }
                    }}
                    className="form-input w-full"
                    placeholder="1.0"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {baseCurrency} equivalent: ${(parseFloat(memberPaymentData.amount || '0') * parseFloat(memberPaymentData.exchange_rate || '1')).toFixed(2)}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={memberPaymentData.payment_date}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setMemberPaymentData({ ...memberPaymentData, payment_date: newDate });
                    if (memberPaymentData.currency !== baseCurrency) {
                      fetchExchangeRate(newDate, memberPaymentData.currency);
                    }
                  }}
                  className="form-input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (Optional)
                </label>
                <textarea
                  value={memberPaymentData.notes}
                  onChange={(e) => setMemberPaymentData({ ...memberPaymentData, notes: e.target.value })}
                  className="form-input w-full"
                  rows={3}
                  placeholder="Payment description or notes..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => {
                  setShowMemberPaymentModal(false);
                  setEditingPaymentId(null);
                  setMemberPaymentData({
                    payer_id: 0,
                    recipient_id: 0,
                    amount: '',
                    currency: baseCurrency,
                    exchange_rate: '1.0',
                    payment_date: new Date().toISOString().split('T')[0],
                    notes: ''
                  });
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={editingPaymentId ? updateMemberPayment : createMemberPayment}
                disabled={isProcessing || !memberPaymentData.payer_id || !memberPaymentData.recipient_id || !memberPaymentData.amount}
                className="btn btn-primary"
              >
                {isProcessing ? (
                  <>
                    <Loader className="h-4 w-4 mr-2 animate-spin" />
                    {editingPaymentId ? 'Updating...' : 'Recording...'}
                  </>
                ) : (
                  editingPaymentId ? 'Update Payment' : 'Record Payment'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentManagementPage;
