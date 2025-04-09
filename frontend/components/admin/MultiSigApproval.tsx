import React, { Fragment, useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, KeyIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { XVERSE, BaseNetwork } from '@omnisat/lasereyes-core';

interface MultiSigApprovalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (signatures: string[]) => void;
  action: {
    type: string;
    description: string;
    data: any;
  } | null;
}

export default function MultiSigApproval({ isOpen, onClose, onComplete, action }: MultiSigApprovalProps) {
  const [signatures, setSignatures] = useState<string[]>([]);
  const [signedAdmins, setSignedAdmins] = useState<string[]>([]);
  const [isSigningInProgress, setIsSigningInProgress] = useState(false);
  const { connect, disconnect, address, signMessage } = useLaserEyes();

  useEffect(() => {
    if (!isOpen) {
      setSignatures([]);
      setSignedAdmins([]);
    }
  }, [isOpen]);

  const handleConnect = async () => {
    try {
      await connect(XVERSE);
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    }
  };

  const handleSign = async () => {
    if (!action || !address || signedAdmins.includes(address)) return;

    setIsSigningInProgress(true);
    try {
      const message = JSON.stringify({
        type: action.type,
        data: action.data,
        timestamp: Date.now(),
        signer: address,
      });

      const signature = await signMessage(message);
      
      setSignatures(prev => [...prev, signature]);
      setSignedAdmins(prev => [...prev, address]);
    } catch (err) {
      console.error('Failed to sign message:', err);
    } finally {
      setIsSigningInProgress(false);
    }
  };

  const canSign = address && !signedAdmins.includes(address) && signatures.length < 3;
  const canComplete = signatures.length >= 3;

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <KeyIcon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      MultiSig Approval Required
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        This action requires approval from 3 out of 5 admin wallets.
                      </p>
                      {action && (
                        <div className="mt-4 bg-gray-50 rounded-lg p-4">
                          <p className="text-sm font-medium text-gray-900">{action.type}</p>
                          <p className="mt-1 text-sm text-gray-500">{action.description}</p>
                        </div>
                      )}
                    </div>

                    {/* Signature Progress */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-900">Signature Progress</h4>
                        <span className="text-sm font-medium text-blue-600">
                          {signatures.length}/5 signatures collected
                        </span>
                      </div>
                      <div className="relative">
                        {/* Progress bar background */}
                        <div className="h-2 bg-gray-200 rounded-full" />
                        {/* Progress bar fill */}
                        <div 
                          className="absolute top-0 h-2 bg-blue-600 rounded-full transition-all duration-300 ease-in-out"
                          style={{ width: `${(signatures.length / 5) * 100}%` }}
                        />
                      </div>
                      <div className="mt-2 space-y-2">
                        {Array.from({ length: 5 }).map((_, index) => (
                          <div
                            key={index}
                            className="flex items-center space-x-2 text-sm"
                          >
                            <div className={`w-2 h-2 rounded-full ${
                              index < signatures.length ? 'bg-green-500' : 'bg-gray-300'
                            }`} />
                            <span className="text-gray-600">
                              Admin {index + 1}
                              {index < signatures.length && (
                                <CheckCircleIcon className="inline-block ml-1 h-4 w-4 text-green-500" />
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  {canComplete ? (
                    <button
                      type="button"
                      className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
                      onClick={() => onComplete(signatures)}
                    >
                      Complete Transaction
                    </button>
                  ) : !address ? (
                    <button
                      type="button"
                      className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
                      onClick={handleConnect}
                    >
                      Connect Wallet
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50 sm:ml-3 sm:w-auto"
                      onClick={handleSign}
                      disabled={!canSign || isSigningInProgress}
                    >
                      {isSigningInProgress ? 'Signing...' : signedAdmins.includes(address) ? 'Already Signed' : 'Sign'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
} 