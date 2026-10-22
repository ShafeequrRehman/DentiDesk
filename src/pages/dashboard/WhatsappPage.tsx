
import React, { useState, useEffect, useCallback } from 'react';
import { fetchWhatsappStatus, fetchWhatsappQR, sendWhatsappMessage, fetchAllCustomers, resetWhatsapp, disconnectWhatsapp } from '@/lib/pos-api';
import { Customer } from '@/lib/pos-types';
import { Send, Users, AlertCircle, CheckCircle2, Phone, MessageSquare, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { useToast } from '@/lib/toast';

interface WhatsAppStatus {
  isConnected: boolean;
  hasQR: boolean;
  socketReady: boolean;
}

export default function WhatsAppManager() {
  const { toast, confirm } = useToast();
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<WhatsAppStatus>({ isConnected: false, hasQR: false, socketReady: false });
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [lastError, setLastError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Manual message state
  const [manualPhone, setManualPhone] = useState('');
  // Patient search: type part of a name or number, pick from the list.
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [pickedName, setPickedName] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [isSendingManual, setIsSendingManual] = useState(false);
  const [manualStatus, setManualStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // Promotions state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [promoMessage, setPromoMessage] = useState('');
  const [isSendingPromo, setIsSendingPromo] = useState(false);
  const [promoProgress, setPromoProgress] = useState(0);

  // Poll status
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetchWhatsappStatus();
      if (res) {
        setStatus(res);
        setLastError((res as { lastError?: string }).lastError || '');
        if (!res.isConnected) {
          fetchQR();
        } else {
          setQrCode(null);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchQR = async () => {
    try {
      const res = await fetchWhatsappQR();
      if (res?.qr) {
        setQrCode(res.qr);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  useEffect(() => {
    fetchAllCustomers().then(c => {
      if (c) setCustomers(c.filter(cust => cust.phone && cust.phone.length >= 10));
    });
  }, []);

  const handleSendManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPhone || !manualMessage) return;
    
    setIsSendingManual(true);
    setManualStatus({ type: null, message: '' });
    try {
      const res = await sendWhatsappMessage(manualPhone, manualMessage);
      if (res?.success) {
        setManualStatus({ type: 'success', message: 'Message sent successfully!' });
        setManualPhone('');
        setManualMessage('');
      } else {
        setManualStatus({ type: 'error', message: res?.error || 'Failed to send message.' });
      }
    } catch (err: any) {
      setManualStatus({ type: 'error', message: err.message || 'An error occurred.' });
    } finally {
      setIsSendingManual(false);
    }
  };

  const handleSendPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoMessage || customers.length === 0) return;
    
    setIsSendingPromo(true);
    setPromoProgress(0);
    
    let sentCount = 0;
    for (let i = 0; i < customers.length; i++) {
        try {
            await sendWhatsappMessage(customers[i].phone, promoMessage);
        } catch {
            console.error(`Failed to send promo to ${customers[i].phone}`);
        }
        sentCount++;
        setPromoProgress(Math.round((sentCount / customers.length) * 100));
        // Randomized 1-2s delay (not a fixed interval) so a bulk blast
        // doesn't look like a bot firing messages at a perfectly even
        // cadence - reduces the chance WhatsApp flags the number for spam.
        const delayMs = 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    toast.success(`Promotion sent to ${sentCount} patients!`);
    setIsSendingPromo(false);
    setPromoMessage('');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp Manager</h1>
        <button onClick={checkStatus} className="p-2 bg-white rounded-md border shadow-inner hover:bg-gray-50 flex items-center gap-2 text-sm">
          <RefreshCw size={16} />
          Refresh Status
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Connection Status Panel */}
        <div className="col-span-1 bg-white rounded-xl shadow-sm border p-6 flex flex-col items-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-green-100 text-green-600">
            <MessageSquare size={32} />
          </div>
          <h2 className="text-xl font-bold mb-2">Connection Status</h2>
          
          {isLoading ? (
            <div className="flex items-center text-gray-500 mt-4">
              <Loader2 className="animate-spin mr-2" /> Checking...
            </div>
          ) : status.isConnected ? (
            <div className="flex flex-col items-center mt-4">
              <div className="flex items-center text-green-600 font-bold bg-green-50 px-4 py-2 rounded-full">
                <CheckCircle2 className="mr-2" /> Connected & Ready
              </div>
              <p className="text-sm text-gray-500 text-center mt-4">
                Your POS is securely linked to WhatsApp and ready to send receipts and promotions.
              </p>
              <button
                type="button"
                disabled={disconnecting}
                onClick={async () => {
                  const ok = await confirm('Disconnect WhatsApp from this clinic? Slips and messages stop until you scan the new QR code (it is also removed from Linked Devices on the phone).', { title: 'Disconnect WhatsApp', confirmText: 'Disconnect', tone: 'danger' });
                  if (!ok) return;
                  setDisconnecting(true);
                  setQrCode(null);
                  try {
                    await disconnectWhatsapp();
                    setStatus((prev) => ({ ...prev, isConnected: false, hasQR: false }));
                    toast.success('WhatsApp disconnected - a new QR code will appear in a few seconds.');
                    setTimeout(() => void checkStatus(), 4000);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not disconnect WhatsApp.');
                  } finally {
                    setDisconnecting(false);
                  }
                }}
                className="mt-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-600 shadow-sm hover:bg-rose-100 disabled:opacity-50"
              >
                {disconnecting ? <Loader2 size={15} className="animate-spin" /> : <Unlink size={15} />} {disconnecting ? 'Disconnecting...' : 'Disconnect WhatsApp'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center mt-4 w-full">
              <div className="flex items-center text-amber-600 font-bold bg-amber-50 px-4 py-2 rounded-full mb-6">
                <AlertCircle className="mr-2" /> Disconnected
              </div>
              
              {qrCode ? (
                <div className="bg-white p-2 border-2 border-gray-100 rounded-lg shadow-sm w-full mx-auto max-w-[250px] aspect-square flex items-center justify-center">
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="bg-gray-50 w-full max-w-[250px] aspect-square flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center">
                  <Loader2 className="animate-spin text-gray-400" />
                  <p className="text-xs font-semibold text-gray-500">Getting a QR code... this can take up to 30 seconds.</p>
                  {lastError ? <p className="text-[11px] font-semibold text-rose-500">Last try failed (code {lastError}).</p> : null}
                </div>
              )}
              <button
                type="button"
                disabled={resetting}
                onClick={async () => {
                  setResetting(true);
                  setQrCode(null);
                  try {
                    await resetWhatsapp();
                    toast.success('Starting fresh - a new QR code will appear in a few seconds.');
                    setTimeout(() => void checkStatus(), 4000);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not reset WhatsApp.');
                  } finally {
                    setResetting(false);
                  }
                }}
                className="mt-3 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={resetting ? 'animate-spin' : ''} /> {resetting ? 'Resetting...' : 'Get a new QR code'}
              </button>
              
              <div className="text-sm text-gray-600 text-center mt-6">
                <p className="font-semibold text-gray-900 mb-1">To connect:</p>
                <ol className="list-decimal text-left pl-6 space-y-1">
                  <li>Open WhatsApp on your phone</li>
                  <li>Tap Menu / Settings and select <b>Linked Devices</b></li>
                  <li>Tap on <b>Link a Device</b></li>
                  <li>Point your phone to this screen to capture the code</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Messaging Panels */}
        <div className="col-span-1 md:col-span-2 space-y-6">
          <div className={`transition-opacity duration-300 ${!status.isConnected ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* Manual Message */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center gap-2 mb-4">
                <Send className="text-indigo-600" />
                <h2 className="text-lg font-bold">Standard Message</h2>
              </div>
              
              <form onSubmit={handleSendManual} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Patient Phone Number</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Phone size={16} className="text-gray-400" />
                    </div>
                    <input 
                      type="text" 
                      value={manualPhone}
                      onChange={(e) => { setManualPhone(e.target.value); setPickedName(''); }}
                      onFocus={() => setPhoneFocused(true)}
                      onBlur={() => setTimeout(() => setPhoneFocused(false), 150)}
                      autoComplete="off"
                      placeholder="Type a name or number, e.g. Ali or 0300" 
                      className="pl-10 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5"
                    />
                    {(() => {
                      const q = manualPhone.trim().toLowerCase();
                      const digits = q.replace(/\D/g, '');
                      if (!phoneFocused || q.length < 2 || pickedName) return null;
                      const matches = customers
                        .filter((c) => (c.name || '').toLowerCase().includes(q) || (digits.length >= 2 && c.phone.replace(/\D/g, '').includes(digits)))
                        .slice(0, 8);
                      if (matches.length === 0) return null;
                      return (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                          {matches.map((c) => (
                            <button
                              key={c.id || c.phone}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { setManualPhone(c.phone); setPickedName(c.name || c.phone); setPhoneFocused(false); }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                            >
                              <span className="truncate font-semibold text-gray-800">{c.name || 'No name'}</span>
                              <span className="shrink-0 text-gray-500">{c.phone}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  {pickedName ? <p className="mt-1 text-xs font-semibold text-emerald-600">Sending to {pickedName}</p> : null}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message Content</label>
                  <textarea 
                    value={manualMessage}
                    onChange={(e) => setManualMessage(e.target.value)}
                    rows={4} 
                    className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-3"
                    placeholder="Type your message here..."
                  />
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    type="submit" 
                    disabled={isSendingManual || !manualPhone || !manualMessage}
                    className="flex-1 bg-indigo-600 text-white rounded-md py-2.5 px-4 font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:bg-gray-300 disabled:cursor-not-allowed flex justify-center items-center"
                  >
                    {isSendingManual ? <Loader2 className="animate-spin" size={20} /> : 'Send Message'}
                  </button>
                  
                  {manualStatus.type && (
                    <div className={`px-3 py-1 rounded-full text-sm font-medium ${manualStatus.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {manualStatus.message}
                    </div>
                  )}
                </div>
              </form>
            </div>

            {/* Mass Promotion (Only visible if connected) */}
            <div className="bg-white rounded-xl shadow-sm border p-6 mt-6 relative overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <Users className="text-orange-600" />
                <h2 className="text-lg font-bold">Marketing Blast</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">Send a promotional message or deal to your entire patient database.</p>
              
              <div className="bg-gray-50 p-4 rounded-lg mb-4 border text-sm">
                <span className="font-semibold text-gray-700">Audience: </span>
                <span className="text-indigo-600 font-bold">{customers.length}</span> Patients with registered valid phone numbers
              </div>

              <form onSubmit={handleSendPromo}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Promotion Message Layout</label>
                  <textarea 
                    value={promoMessage}
                    onChange={e => setPromoMessage(e.target.value)}
                    rows={5} 
                    className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-orange-500 focus:ring-orange-500 sm:text-sm p-3"
                    placeholder="Hi! Check out our new weekend deals at The Heaven Slice! 🔥🍕"
                  />
                  <p className="text-xs text-gray-500 mt-2">To prevent spam blocks, messages are sent one at a time with a random 1-2 second gap between each patient.</p>
                </div>

                {isSendingPromo ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm font-medium text-gray-700">
                      <span>Sending Broadcast...</span>
                      <span>{promoProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className="bg-orange-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${promoProgress}%` }}></div>
                    </div>
                  </div>
                ) : (
                  <button 
                    type="submit" 
                    disabled={!promoMessage || customers.length === 0}
                    className="w-full bg-orange-600 text-white rounded-md py-2.5 px-4 font-medium hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:bg-gray-300 flex justify-center items-center gap-2"
                  >
                    <Send size={18} />
                    Blast to {customers.length} Patients
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
