import React, { useMemo } from 'react';
import { useCurrencyToggle } from '../src/hooks/useCurrencyToggle';
import { useNAV } from '../src/hooks/useNAV';
import dynamic from 'next/dynamic';

interface NAVDisplayProps {
  size?: 'sm' | 'md' | 'lg';
  showChange?: boolean;
}

// The simplified component implementation
function NAVDisplayComponent({ size = 'md', showChange = true }: NAVDisplayProps) {
  // Use the centralized NAV hook for data, loading, and error states
  const { nav, loading, error, formattedNAV } = useNAV();
  const { currency } = useCurrencyToggle();
  
  // Format values directly from the useNAV hook's data
  // And ensure consistent rendering between server and client
  const formattedValues = useMemo(() => {
    // Use the formattedNAV from the hook, which already considers currency
    const formattedTotalValue = currency === 'usd' 
      ? nav.formattedNavUsd
      : nav.formattedNavSats;
    
    // Format change percentage with safety checks
    let changePercentage = nav.changePercentage ?? 0;
    const isPositive = changePercentage >= 0;
    const formattedChangePercentage = `${isPositive ? '+' : ''}${changePercentage.toFixed(2)}%`;

    return {
      formattedTotalValue,
      formattedChangePercentage,
      isPositive
    };
  }, [currency, nav]); // Depend only on currency and nav data from the hook
  
  // Size classes
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };
  
  const valueSize = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl'
  };
  
  return (
    <div className="flex items-center">
      {/* Display Loading / Error State from useNAV */}
      {loading && <p className="text-sm text-primary opacity-75 italic">Loading NAV...</p>}
      {!loading && error && <p className="text-sm text-error italic">{error}</p>}
      
      {/* Only display value when not loading and no error */}
      {!loading && !error && (
        <div>
          <p className={`${sizes[size]} text-primary font-medium mb-0.5`}>
            Net Asset Value (NAV)
          </p>
          <div className="flex items-center">
            <p className={`${valueSize[size]} font-bold text-primary mr-2`}>
              {formattedValues.formattedTotalValue}
            </p>
            
            {showChange && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                formattedValues.isPositive ? 'bg-success bg-opacity-10 text-success' : 'bg-error bg-opacity-10 text-error'
              }`}>
                {formattedValues.formattedChangePercentage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Export a client-side only version of the component to avoid hydration issues
// This ensures this component only renders on the client, not during server-side rendering
const NAVDisplay = dynamic(() => Promise.resolve(NAVDisplayComponent), {
  ssr: false,
});

export default NAVDisplay; 