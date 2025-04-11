import React, { ReactNode } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import CurrencyToggle from './CurrencyToggle';
import WalletConnector from './WalletConnector';
import dynamic from 'next/dynamic';

// Import NAVDisplay with client-side only rendering
const NAVDisplay = dynamic(() => import('./NAVDisplay'), { ssr: false });

type LayoutProps = {
  children: ReactNode;
  title?: string;
};

export default function Layout({ children, title = 'OTORI Vision Token' }: LayoutProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-accent-white flex flex-col">
      <Head>
        <title>{title} | OTORI</title>
        <meta name="description" content="OTORI Vision" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className="flex-grow pb-8">
        {children}
      </main>
      
      <footer className="bg-white text-primary mt-auto border-t border-primary border-opacity-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div className="text-sm">
              &copy; {new Date().getFullYear()} OTORI Vision. All rights reserved.
            </div>
            <div className="text-sm text-primary">
              Running on Bitcoin Testnet
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
} 