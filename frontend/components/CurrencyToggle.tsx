import React from 'react';
import { useCurrencyToggle } from '@/hooks/useCurrencyToggle';

interface CurrencyToggleProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

/**
 * CurrencyToggle component allows users to switch between BTC and USD currency display
 */
const CurrencyToggle: React.FC<CurrencyToggleProps> = ({
  className = '',
  size = 'md',
  showLabel = true
}) => {
  const { currency, toggleCurrency } = useCurrencyToggle();
  
  // Define size classes
  const sizeClasses = {
    sm: 'text-xs p-1 min-w-12',
    md: 'text-sm p-2 min-w-16',
    lg: 'text-base p-3 min-w-20'
  };
  
  // Generate the base class list
  const baseClasses = `
    rounded-full 
    font-medium 
    flex 
    items-center 
    justify-center 
    ${sizeClasses[size]}
    transition-all 
    duration-200
  `;
  
  // Active and inactive states
  const btcClasses = currency === 'btc' 
    ? 'bg-primary text-white shadow-md' 
    : 'bg-white text-primary border border-primary hover:bg-primary-light hover:bg-opacity-10';
  
  const usdClasses = currency === 'usd' 
    ? 'bg-primary text-white shadow-md' 
    : 'bg-white text-primary border border-primary hover:bg-primary-light hover:bg-opacity-10';
  
  return (
    <div className={`
      flex 
      items-center 
      bg-white
      border
      border-primary
      rounded-lg
      p-2
      ${className}
    `}>
      {showLabel && (
        <span className="mr-2 text-primary text-xs font-medium">
          Currency:
        </span>
      )}
      <div className="flex">
        <button
          onClick={() => currency !== 'btc' && toggleCurrency()}
          className={`${baseClasses} ${btcClasses} rounded-l-md`}
          aria-label="Switch to BTC"
        >
          ₿
        </button>
        <button
          onClick={() => currency !== 'usd' && toggleCurrency()}
          className={`${baseClasses} ${usdClasses} rounded-r-md border-l border-primary border-opacity-20`}
          aria-label="Switch to USD"
        >
          $
        </button>
      </div>
    </div>
  );
};

export default CurrencyToggle; 