import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, Calendar, User, MapPin, Printer } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import type { UserAgreement } from '../types';

const AgreementDetailsPage: React.FC = () => {
  const { agreementId } = useParams<{ agreementId: string }>();
  const { user } = useAuthStore();
  const { companyName } = useBrandingStore();
  const [agreement, setAgreement] = useState<UserAgreement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadAgreement = async () => {
      if (!agreementId) {
        setError('No agreement ID provided');
        setIsLoading(false);
        return;
      }

      try {
        // This would need a new API endpoint to get agreement by ID
        const response = await fetch(`/api/admin/agreements/${agreementId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setAgreement(data);
        } else {
          setError('Agreement not found or access denied');
        }
      } catch (err) {
        setError('Failed to load agreement details');
      } finally {
        setIsLoading(false);
      }
    };

    loadAgreement();
  }, [agreementId]);

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600">Only administrators can view agreement details.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading agreement details...</p>
        </div>
      </div>
    );
  }

  if (error || !agreement) {
    return (
      <div className="space-y-6">
        <div className="flex items-center">
          <Link to="/admin?tab=users" className="p-2 hover:bg-gray-100 rounded-lg transition-colors mr-3">
            <ArrowLeft className="h-6 w-6" />
          </Link>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-600 text-lg">{error || 'Agreement not found'}</p>
          <Link to="/admin?tab=users" className="btn btn-secondary mt-4">
            Back to Admin Panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center no-print">
        <Link to="/admin?tab=users" className="p-2 hover:bg-gray-100 rounded-lg transition-colors mr-3">
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div className="text-sm text-gray-500">
          <Link to="/admin?tab=users" className="hover:text-primary-600">Admin Panel</Link>
          <span className="mx-2">→</span>
          <span>Agreement Details</span>
        </div>
      </div>

      {/* Agreement Details */}
      <div className="card p-8 print:p-0 print:shadow-none print:border-none">
        <div className="flex items-center mb-6">
          <FileText className="h-8 w-8 text-blue-600 mr-3" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Signed Agreement Details</h1>
            <p className="text-gray-600">Version {agreement.version} • Signed Agreement</p>
          </div>
        </div>

        {/* Signature Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 no-print">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Signature Details</h3>
            
            <div className="flex items-center">
              <User className="h-4 w-4 text-gray-400 mr-2" />
              <div>
                <span className="font-medium">Signed by:</span> {agreement.full_name}
              </div>
            </div>
            
            <div className="flex items-center">
              <Calendar className="h-4 w-4 text-gray-400 mr-2" />
              <div>
                <span className="font-medium">Signed on:</span> {new Date(agreement.signed_at).toLocaleString()}
              </div>
            </div>
            
            <div className="flex items-center">
              <MapPin className="h-4 w-4 text-gray-400 mr-2" />
              <div>
                <span className="font-medium">IP Address:</span> {agreement.ip_address || 'Not recorded'}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Agreement Info</h3>

            <div>
              <span className="font-medium">Type:</span>
              <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                agreement.agreement_type === 'employment' ? 'bg-purple-100 text-purple-700'
                : agreement.agreement_type === 'custom' ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-700'
              }`}>
                {agreement.agreement_type || 'team'}
              </span>
            </div>

            <div>
              <span className="font-medium">Email Address:</span> {agreement.email}
            </div>

            {agreement.quiz_answer && (
              <div>
                <span className="font-medium">Quiz Answer:</span> {agreement.quiz_answer}
              </div>
            )}

            <div>
              <span className="font-medium">Digital Signature:</span> "{agreement.digital_signature}"
            </div>

            <div>
              <span className="font-medium">Status:</span>
              <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                agreement.status === 'signed'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {agreement.status}
              </span>
            </div>

            <div>
              <span className="font-medium">Payroll details on file:</span>
              <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                agreement.payroll_on_file ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {agreement.payroll_on_file ? 'yes' : 'no'}
              </span>
              {!!agreement.payroll_on_file && agreement.user_id && (
                <span className="ml-2 text-xs text-gray-500">(reveal via the user's profile — access is logged)</span>
              )}
            </div>
          </div>
        </div>

        {/* Signed confirmations */}
        {(() => {
          const signedKeys: string[] = typeof agreement.confirmations === 'string'
            ? (() => { try { return JSON.parse(agreement.confirmations as string); } catch { return []; } })()
            : (Array.isArray(agreement.confirmations) ? agreement.confirmations : []);
          const versionConfs: { key: string; label: string }[] = typeof agreement.version_confirmations === 'string'
            ? (() => { try { return JSON.parse(agreement.version_confirmations as string); } catch { return []; } })()
            : (Array.isArray(agreement.version_confirmations) ? agreement.version_confirmations : []);
          if (signedKeys.length === 0 && versionConfs.length === 0) return null;
          const items = versionConfs.length > 0
            ? versionConfs.map(c => ({ label: c.label, ticked: signedKeys.length === 0 || signedKeys.includes(c.key) }))
            : signedKeys.map(k => ({ label: k, ticked: true }));
          return (
            <div className="mb-8 no-print">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Confirmations</h3>
              <ul className="space-y-1">
                {items.map((item, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    {item.ticked ? '☑' : '☐'} {item.label}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* Print Button */}
        <div className="border-t border-gray-200 pt-6 mb-6 no-print">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Complete Signed Agreement</h3>
            <button
              onClick={() => window.print()}
              className="btn btn-secondary flex items-center"
            >
              <Printer className="h-4 w-4 mr-2" />
              Print Agreement
            </button>
          </div>
        </div>

        {/* Full Agreement Content */}
        <div className="border-t border-gray-200 pt-6" id="printable-agreement">
          <div className="print:block">
            {/* Print Header */}
            <div className="hidden print:block mb-8 text-center border-b pb-4">
              <h1 className="text-2xl font-bold">{companyName} Intranet - Signed Agreement</h1>
              <p className="text-gray-600 mt-2">
                Signed by: {agreement.full_name} • Date: {new Date(agreement.signed_at).toLocaleDateString()} • Version: {agreement.version}
              </p>
            </div>

            {/* Agreement Content */}
            <div className="prose max-w-none">
              {agreement.content ? (
                <div dangerouslySetInnerHTML={{ __html: agreement.content }} />
              ) : (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <p className="text-gray-600">
                    <strong>Agreement Title:</strong> {agreement.title}
                  </p>
                  <p className="text-gray-600 mt-2">
                    Complete agreement content for version {agreement.version}. 
                    The full legal text was presented to and signed by the user.
                  </p>
                </div>
              )}
            </div>

            {/* Print Footer */}
            <div className="hidden print:block mt-8 pt-4 border-t">
              <div className="text-sm text-gray-600 space-y-1">
                <p><strong>Digital Signature:</strong> "{agreement.digital_signature}"</p>
                <p><strong>IP Address:</strong> {agreement.ip_address}</p>
                <p><strong>Quiz Answer:</strong> {agreement.quiz_answer}</p>
                <p><strong>Email:</strong> {agreement.email}</p>
                <p><strong>Signature Timestamp:</strong> {new Date(agreement.signed_at).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgreementDetailsPage;