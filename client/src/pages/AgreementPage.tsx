import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FileText, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { agreementsApi } from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import type { AgreementVersion, AssignmentDetail, AgreementConfirmation, PayrollFormData } from '../types';

// Legacy fallback: the four confirmations that used to be hard-coded here, used
// only if the loaded version carries no confirmations of its own.
const LEGACY_CONFIRMATIONS: AgreementConfirmation[] = [
  { key: 'ipAssign', label: 'I assign Venture-related IP I create to No-Hands Apps and agree to confidentiality.' },
  { key: 'separateAgreements', label: 'I understand that negotiations for sales commissions and revenue share will be made separately from this agreement.' },
  { key: 'noEquityGuarantee', label: "I understand there's no guarantee of equity even after incorporation." },
  { key: 'notSubcontractor', label: 'I understand this does not make me a subcontractor or employee; any subcontracting would require a separate written agreement.' },
];

// Canadian payroll field validation, mirrored server-side (server is authoritative)
function normalizeDigits(v: string): string {
  return (v || '').replace(/[\s-]/g, '');
}
function isValidSIN(v: string): boolean {
  const sin = normalizeDigits(v);
  if (!/^\d{9}$/.test(sin)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(sin[i], 10);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
const isValidInstitution = (v: string) => /^\d{3}$/.test(normalizeDigits(v));
const isValidTransit = (v: string) => /^\d{5}$/.test(normalizeDigits(v));
const isValidAccount = (v: string) => /^\d{7,12}$/.test(normalizeDigits(v));
const isValidPostal = (v: string) => /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test((v || '').trim());
const isValidDob = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && Date.parse(v) < Date.now();

function parseMaybeJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return null;
}

const AgreementPage: React.FC = () => {
  const navigate = useNavigate();
  const { assignmentId } = useParams<{ assignmentId?: string }>();
  const isAssignmentMode = !!assignmentId;
  const { user, updateUser, login } = useAuthStore();

  const [agreement, setAgreement] = useState<AgreementVersion | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [quizAnswer, setQuizAnswer] = useState('');
  const [digitalSignature, setDigitalSignature] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [payroll, setPayroll] = useState<PayrollFormData>({});
  const [payrollTouched, setPayrollTouched] = useState<Record<string, boolean>>({});

  // The version being displayed, regardless of mode
  const version: (AgreementVersion | AssignmentDetail) | null = isAssignmentMode ? assignment : agreement;

  const confirmations: AgreementConfirmation[] = useMemo(() => {
    const fromVersion = parseMaybeJson<AgreementConfirmation[]>(version?.confirmations as unknown);
    if (fromVersion && fromVersion.length > 0) return fromVersion;
    return isAssignmentMode ? [] : LEGACY_CONFIRMATIONS;
  }, [version, isAssignmentMode]);

  const requiredFields: string[] = useMemo(() => {
    const fields = isAssignmentMode
      ? assignment?.required_fields
      : parseMaybeJson<string[]>((agreement as AgreementVersion | null)?.required_fields as unknown);
    return Array.isArray(fields) ? fields : [];
  }, [assignment, agreement, isAssignmentMode]);

  const quizQuestion = version?.quiz_question || null;
  // The legacy team quiz uses fixed before/after radio options
  const useLegacyQuizOptions = !isAssignmentMode;

  useEffect(() => {
    const load = async () => {
      try {
        if (isAssignmentMode) {
          const detail = await agreementsApi.getAssignment(assignmentId!);
          if (detail.status === 'signed') {
            setSuccessMessage(`You signed "${detail.title}" on ${detail.signed_at ? new Date(detail.signed_at).toLocaleDateString() : ''}.`);
          }
          setAssignment(detail);
        } else {
          // Legacy team-agreement flow, unchanged in behaviour
          if (user?.role !== 'pending_agreement') {
            try {
              const status = await agreementsApi.getAgreementStatus();
              if (status.has_signed) {
                navigate('/dashboard');
                return;
              }
            } catch {
              // proceed with display
            }
          }
          const currentAgreement = await agreementsApi.getCurrentAgreement();
          setAgreement(currentAgreement);
        }
        setFullName(user?.name || '');
        setEmail(user?.email || '');
      } catch (e) {
        if (retryCount < 3) {
          setTimeout(() => setRetryCount(prev => prev + 1), 2000);
          return;
        }
        setError('Failed to load agreement after 3 attempts. Please try refreshing the page.');
      } finally {
        setIsLoading(false);
      }
    };
    if (user) load();
  }, [user, navigate, retryCount, assignmentId, isAssignmentMode]);

  const payrollErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (requiredFields.includes('sin')) {
      if (!isValidSIN(payroll.sin || '')) errs.sin = 'Enter a valid 9-digit SIN';
    }
    if (requiredFields.includes('direct_deposit')) {
      if (!isValidInstitution(payroll.bank_institution || '')) errs.bank_institution = '3 digits';
      if (!isValidTransit(payroll.bank_transit || '')) errs.bank_transit = '5 digits';
      if (!isValidAccount(payroll.bank_account || '')) errs.bank_account = '7-12 digits';
    }
    if (requiredFields.includes('address')) {
      if (!(payroll.address_line1 || '').trim()) errs.address_line1 = 'Required';
      if (!(payroll.city || '').trim()) errs.city = 'Required';
      if (!(payroll.province || '').trim()) errs.province = 'Required';
      if (!isValidPostal(payroll.postal_code || '')) errs.postal_code = 'e.g. V2S 7M8';
    }
    if (requiredFields.includes('date_of_birth')) {
      if (!isValidDob(payroll.date_of_birth || '')) errs.date_of_birth = 'YYYY-MM-DD, in the past';
    }
    return errs;
  }, [requiredFields, payroll]);

  const isFormValid = () => {
    const allConfirmed = confirmations.every(c => checked[c.key]);
    const quizOk = !quizQuestion || (useLegacyQuizOptions ? quizAnswer.toLowerCase() === 'after' : quizAnswer.trim().length > 0);
    const signatureOk = digitalSignature.toLowerCase() === 'agree';
    const basicOk = fullName.trim() && email.trim();
    const payrollOk = Object.keys(payrollErrors).length === 0;
    return allConfirmed && quizOk && signatureOk && basicOk && payrollOk;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid()) {
      setError('Please complete all required fields' + (quizQuestion ? ' and answer the quiz correctly.' : '.'));
      return;
    }
    setIsSigning(true);
    setError('');
    try {
      if (isAssignmentMode) {
        const result = await agreementsApi.signAssignment(assignmentId!, {
          full_name: fullName.trim(),
          email: email.trim(),
          quiz_answer: quizQuestion ? quizAnswer.trim() : undefined,
          digital_signature: digitalSignature.trim(),
          confirmations: checked,
          payroll: requiredFields.length > 0 ? payroll : undefined,
        });
        setSuccessMessage(`"${result.title}" signed successfully.` + (result.payroll_details_saved ? ' Your payroll details were saved securely — you can view them (masked) on your profile.' : ''));
        setAssignment(prev => (prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev));
      } else {
        const response = await agreementsApi.signAgreement({
          full_name: fullName.trim(),
          email: email.trim(),
          quiz_answer: quizAnswer.trim(),
          digital_signature: digitalSignature.trim(),
          confirmations: checked,
        });
        if (response.token && response.user) {
          login(response.token, response.user);
        } else {
          updateUser({ role: 'user' });
        }
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to sign agreement. Please try again.');
    } finally {
      setIsSigning(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading agreement...</p>
        </div>
      </div>
    );
  }

  if (!version) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Agreement Not Available</h2>
          <p className="text-gray-600">{error || 'No agreement found.'}</p>
          <div className="mt-4">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  const alreadySigned = isAssignmentMode && assignment?.status === 'signed';

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          {/* Header */}
          <div className="bg-blue-600 px-6 py-4">
            <div className="flex items-center">
              <FileText className="h-8 w-8 text-white mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-white">{version.title}</h1>
                <p className="text-blue-100">
                  Version {version.version}
                  {isAssignmentMode ? ' • Assigned to you for signature' : ' • Required for platform access'}
                </p>
              </div>
            </div>
          </div>

          {/* Agreement Content */}
          <div className="p-6">
            <div className="prose max-w-none mb-8">
              {version.content ? (
                <div dangerouslySetInnerHTML={{ __html: version.content }} />
              ) : (
                <p>Loading agreement content...</p>
              )}
            </div>
          </div>

          {alreadySigned ? (
            <div className="border-t border-gray-200 p-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start">
                <CheckCircle className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-green-800">Signed</p>
                  <p className="text-sm text-green-700">{successMessage || 'You have already signed this agreement.'}</p>
                  <button
                    onClick={() => navigate('/dashboard')}
                    className="mt-3 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                  >
                    Back to Dashboard
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-200 p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Digital Signature</h3>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                {confirmations.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Confirmations (all required):</h4>
                    {confirmations.map((c) => (
                      <label key={c.key} className="flex items-start">
                        <input
                          type="checkbox"
                          checked={!!checked[c.key]}
                          onChange={(e) => setChecked({ ...checked, [c.key]: e.target.checked })}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <span className="ml-3 text-sm text-gray-700">{c.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                {quizQuestion && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium text-gray-900 mb-3">Quick Quiz (must answer correctly to proceed):</h4>
                    <p className="text-gray-700 mb-3">{quizQuestion}</p>
                    {useLegacyQuizOptions ? (
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="quiz"
                            value="before"
                            checked={quizAnswer === 'before'}
                            onChange={(e) => setQuizAnswer(e.target.value)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                          />
                          <span className="ml-3 text-sm text-gray-700">Before incorporation</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="quiz"
                            value="after"
                            checked={quizAnswer === 'after'}
                            onChange={(e) => setQuizAnswer(e.target.value)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                          />
                          <span className="ml-3 text-sm text-gray-700">After incorporation</span>
                        </label>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={quizAnswer}
                        onChange={(e) => setQuizAnswer(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Your answer"
                      />
                    )}
                  </div>
                )}

                {requiredFields.length > 0 && (
                  <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-4">
                    <div className="flex items-start">
                      <ShieldCheck className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="font-medium text-gray-900">Payroll &amp; Banking Information</h4>
                        <p className="text-xs text-gray-600 mt-1">
                          This information is encrypted before it is stored and is used only for payroll
                          and CRA reporting. It is never shown in full to anyone except payroll
                          administrators, and every access is logged.
                        </p>
                      </div>
                    </div>

                    {requiredFields.includes('sin') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Social Insurance Number (SIN) *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={payroll.sin || ''}
                          onChange={(e) => setPayroll({ ...payroll, sin: e.target.value })}
                          onBlur={() => setPayrollTouched({ ...payrollTouched, sin: true })}
                          placeholder="123-456-789"
                          className="w-full md:w-64 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        {payrollTouched.sin && payrollErrors.sin && (
                          <p className="text-xs text-red-600 mt-1">{payrollErrors.sin}</p>
                        )}
                      </div>
                    )}

                    {requiredFields.includes('direct_deposit') && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Institution # *</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={payroll.bank_institution || ''}
                            onChange={(e) => setPayroll({ ...payroll, bank_institution: e.target.value })}
                            onBlur={() => setPayrollTouched({ ...payrollTouched, bank_institution: true })}
                            placeholder="004"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {payrollTouched.bank_institution && payrollErrors.bank_institution && (
                            <p className="text-xs text-red-600 mt-1">{payrollErrors.bank_institution}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Transit # *</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={payroll.bank_transit || ''}
                            onChange={(e) => setPayroll({ ...payroll, bank_transit: e.target.value })}
                            onBlur={() => setPayrollTouched({ ...payrollTouched, bank_transit: true })}
                            placeholder="12345"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {payrollTouched.bank_transit && payrollErrors.bank_transit && (
                            <p className="text-xs text-red-600 mt-1">{payrollErrors.bank_transit}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Account # *</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={payroll.bank_account || ''}
                            onChange={(e) => setPayroll({ ...payroll, bank_account: e.target.value })}
                            onBlur={() => setPayrollTouched({ ...payrollTouched, bank_account: true })}
                            placeholder="1234567"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {payrollTouched.bank_account && payrollErrors.bank_account && (
                            <p className="text-xs text-red-600 mt-1">{payrollErrors.bank_account}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {requiredFields.includes('address') && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Address line 1 *</label>
                          <input
                            type="text"
                            autoComplete="off"
                            value={payroll.address_line1 || ''}
                            onChange={(e) => setPayroll({ ...payroll, address_line1: e.target.value })}
                            onBlur={() => setPayrollTouched({ ...payrollTouched, address_line1: true })}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {payrollTouched.address_line1 && payrollErrors.address_line1 && (
                            <p className="text-xs text-red-600 mt-1">{payrollErrors.address_line1}</p>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Address line 2</label>
                          <input
                            type="text"
                            autoComplete="off"
                            value={payroll.address_line2 || ''}
                            onChange={(e) => setPayroll({ ...payroll, address_line2: e.target.value })}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                          <input
                            type="text"
                            autoComplete="off"
                            value={payroll.city || ''}
                            onChange={(e) => setPayroll({ ...payroll, city: e.target.value })}
                            onBlur={() => setPayrollTouched({ ...payrollTouched, city: true })}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                          {payrollTouched.city && payrollErrors.city && (
                            <p className="text-xs text-red-600 mt-1">{payrollErrors.city}</p>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Province *</label>
                            <input
                              type="text"
                              autoComplete="off"
                              value={payroll.province || ''}
                              onChange={(e) => setPayroll({ ...payroll, province: e.target.value })}
                              onBlur={() => setPayrollTouched({ ...payrollTouched, province: true })}
                              placeholder="BC"
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {payrollTouched.province && payrollErrors.province && (
                              <p className="text-xs text-red-600 mt-1">{payrollErrors.province}</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Postal code *</label>
                            <input
                              type="text"
                              autoComplete="off"
                              value={payroll.postal_code || ''}
                              onChange={(e) => setPayroll({ ...payroll, postal_code: e.target.value })}
                              onBlur={() => setPayrollTouched({ ...payrollTouched, postal_code: true })}
                              placeholder="V2S 7M8"
                              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {payrollTouched.postal_code && payrollErrors.postal_code && (
                              <p className="text-xs text-red-600 mt-1">{payrollErrors.postal_code}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {requiredFields.includes('date_of_birth') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth *</label>
                        <input
                          type="date"
                          autoComplete="off"
                          value={payroll.date_of_birth || ''}
                          onChange={(e) => setPayroll({ ...payroll, date_of_birth: e.target.value })}
                          onBlur={() => setPayrollTouched({ ...payrollTouched, date_of_birth: true })}
                          className="w-full md:w-64 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        {payrollTouched.date_of_birth && payrollErrors.date_of_birth && (
                          <p className="text-xs text-red-600 mt-1">{payrollErrors.date_of_birth}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Type "Agree" to sign digitally *
                  </label>
                  <input
                    type="text"
                    value={digitalSignature}
                    onChange={(e) => setDigitalSignature(e.target.value)}
                    placeholder="Agree"
                    autoComplete="off"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">Must type exactly "Agree" to proceed</p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!isFormValid() || isSigning}
                    className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                  >
                    {isSigning ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Signing Agreement...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Sign Agreement
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgreementPage;
