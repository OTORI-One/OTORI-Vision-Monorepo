import Layout from '../components/Layout';
import AdminDashboard from '../components/admin/AdminDashboard';
import { useLaserEyes } from '@omnisat/lasereyes-react';
import { BaseNetwork } from '@omnisat/lasereyes-core';
import React, { useEffect, useState } from 'react';
import { isAdminWallet } from '../src/utils/adminUtils';

export default function AdminPage() {
  const { address } = useLaserEyes();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Check admin status independently in this component
  useEffect(() => {
    console.log('Admin Page - Checking admin status for address:', address);
    
    if (!address) {
      console.log('Admin Page - No wallet connected');
      setIsAdmin(false);
      setIsChecking(false);
      return;
    }
    
    const adminStatus = isAdminWallet(address);
    console.log('Admin Page - Admin status:', adminStatus);
    setIsAdmin(adminStatus);
    setIsChecking(false);
  }, [address]);

  return (
    <Layout title="Admin Dashboard">
      {isChecking ? (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="animate-pulse flex flex-col items-center justify-center p-12">
            <div className="h-8 w-48 bg-gray-200 rounded mb-4"></div>
            <div className="text-gray-500">Verifying admin access...</div>
          </div>
        </div>
      ) : (
        <AdminDashboard />
      )}
    </Layout>
  );
}
