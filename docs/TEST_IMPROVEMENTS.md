# Test Improvements

## Recent Test Fixes

The following tests were fixed to make them more resilient to dependency changes:

1. **PositionManagement Tests**
   - Changed `getByText('Test Position')` to look for list items with `getAllByRole('listitem')` to be less brittle
   - Updated error message expectation to use more flexible pattern matching
   - Modified object expectations to use `expect.objectContaining()` to allow for additional properties

2. **PortfolioChart Tests**
   - Added null/undefined checking in the mock formatter to prevent `toFixed()` errors
   - Made the mocks more resilient to prop changes

## Best Practices for Future Tests

To ensure tests are resilient to dependency changes, follow these guidelines:

### 1. Use Semantic Queries Instead of Text-Based Queries

Prefer:
```javascript
// Better - more resilient to text changes
screen.getAllByRole('listitem')
screen.getByRole('button', { name: /submit/i })
```

Instead of:
```javascript
// Brittle - breaks when text changes
getByText('List Item 1')
```

### 2. Test Behavior, Not Implementation

Prefer:
```javascript
// Better - tests what the user sees/interacts with
expect(screen.getByRole('alert')).toBeInTheDocument()
```

Instead of:
```javascript
// Brittle - assumes specific internal state
expect(component.state.error).toBe('Some error message')
```

### 3. Use Flexible Matchers for External Data

Prefer:
```javascript
// Better - allows for additional properties or slightly different formatting
expect(mockOnActionRequiringMultiSig).toHaveBeenCalledWith(
  expect.objectContaining({
    type: 'ADD_POSITION',
    data: expect.objectContaining({
      name: 'Test Project'
    })
  })
)
```

Instead of:
```javascript
// Brittle - breaks when additional properties are added
expect(mockOnActionRequiringMultiSig).toHaveBeenCalledWith({
  type: 'ADD_POSITION',
  data: {
    name: 'Test Project',
    value: 100
  }
})
```

### 4. Create Robust Mocks

Make mocks defensively handle edge cases:

```javascript
// Robust mock with error handling
jest.mock('../../hooks/useCurrencyToggle', () => ({
  useCurrencyToggle: () => ({
    formatValue: (value) => {
      if (value === undefined || value === null) {
        return '$0.00';
      }
      return `$${value.toFixed(2)}`;
    }
  })
}));
```

### 5. Test Error States and Edge Cases

Always include tests for:
- Empty data states
- Loading states
- Error handling
- Boundary conditions

### 6. Use `act()` for State Updates

Wrap all operations that cause state updates:

```javascript
await act(async () => {
  fireEvent.change(input, { target: { value: 'new value' } });
  fireEvent.click(submitButton);
});
```

### 7. Clean Up Mocks and Spies

Always restore mocks and spies to avoid affecting other tests:

```javascript
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
// ... test code ...
consoleSpy.mockRestore();
```

## Next Steps for Test Improvement

- [ ] Create more reusable test utilities for common patterns
- [ ] Refactor tests to use Testing Library's best practices consistently
- [ ] Add more integration tests to verify component interactions
- [ ] Consider using MSW for API mocking instead of mocking fetch directly 