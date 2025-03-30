import { Fragment, useRef } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useLaserEyes } from '@omnisat/lasereyes';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';

export interface TransactionDetails {
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  totalValue: number;
  feeEstimate?: number;
  tokenSymbol?: string;
}

interface TransactionConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  transactionDetails: TransactionDetails;
  isProcessing?: boolean;
}

export default function TransactionConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  transactionDetails,
  isProcessing = false
}: TransactionConfirmationModalProps) {
  const cancelButtonRef = useRef(null);
  const { network } = useLaserEyes();
  const { currency } = useCurrencyToggle();
  
  const {
    type,
    amount,
    price,
    totalValue,
    feeEstimate = 0,
    tokenSymbol = 'OVT'
  } = transactionDetails;
  
  // Format values based on current currency
  const formatValue = (value: number): string => {
    if (currency === 'btc') {
      // Show in sats
      return `${value.toLocaleString()} sats`;
    } else {
      // Show in USD
      return `$${value.toFixed(2)}`;
    }
  };
  
  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        initialFocus={cancelButtonRef}
        onClose={isProcessing ? () => {} : onClose}
      >
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
                <div className="absolute right-0 top-0 hidden pr-4 pt-4 sm:block">
                  <button
                    type="button"
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    onClick={onClose}
                    disabled={isProcessing}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-yellow-100 sm:mx-0 sm:h-10 sm:w-10">
                    <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
                    <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-gray-900">
                      Confirm {type === 'buy' ? 'Purchase' : 'Sale'} of {tokenSymbol}
                    </Dialog.Title>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Please review the transaction details before confirming. This operation cannot be undone.
                      </p>
                    </div>
                    
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Transaction Type:</span>
                          <span className={`text-sm font-medium ${type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                            {type === 'buy' ? 'Buy' : 'Sell'} {tokenSymbol}
                          </span>
                        </div>
                        
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Amount:</span>
                          <span className="text-sm font-medium">{amount} {tokenSymbol}</span>
                        </div>
                        
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Price per {tokenSymbol}:</span>
                          <span className="text-sm font-medium">{formatValue(price)}</span>
                        </div>
                        
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Total Value:</span>
                          <span className="text-sm font-medium">{formatValue(totalValue)}</span>
                        </div>
                        
                        {feeEstimate > 0 && (
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Network Fee (est.):</span>
                            <span className="text-sm font-medium">{formatValue(feeEstimate)}</span>
                          </div>
                        )}
                        
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Network:</span>
                          <span className="text-sm font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                            {network || 'Signet'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="button"
                    className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm sm:ml-3 sm:w-auto ${
                      type === 'buy' 
                        ? 'bg-primary hover:bg-primary-dark focus:ring-primary' 
                        : 'bg-red-600 hover:bg-red-700 focus:ring-red-600'
                    } focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50`}
                    onClick={onConfirm}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : (
                      `Confirm ${type === 'buy' ? 'Purchase' : 'Sale'}`
                    )}
                  </button>
                  <button
                    type="button"
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                    onClick={onClose}
                    ref={cancelButtonRef}
                    disabled={isProcessing}
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