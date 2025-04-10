// No imports needed for this component

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  color?: string; // Allow overriding color, defaults to highlight
}

const sizeClasses = {
  xs: 'h-3 w-3',
  sm: 'h-5 w-5',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

const Spinner: React.FC<SpinnerProps> = ({ size = 'md', color = 'text-[#7bc6d5]' /* Vibrant Cyan */ }) => {
  const spinnerSize = sizeClasses[size] || sizeClasses.md;

  return (
    <svg
      className={`animate-spin ${spinnerSize} ${color}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true" // Hide from screen readers as it's decorative
      role="status" // Indicate it's a status indicator
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
       {/* Optional: Add a title for accessibility if needed, though aria-hidden might suffice */}
       {/* <title>Loading...</title> */}
    </svg>
  );
};

export default Spinner;