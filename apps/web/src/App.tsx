import React, { useState, useEffect } from 'react';
import { PosPage } from './pages/PosPage';
import { PublicReceiptPage } from './pages/PublicReceiptPage';
import { OwnerVoidApprovePage } from './pages/OwnerVoidApprovePage';

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return typeof window !== 'undefined' ? window.location.pathname : '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 1. Digital Receipt Public Page: /r/:invoice
  if (currentPath.startsWith('/r/')) {
    const invoice = currentPath.slice(3).trim();
    return <PublicReceiptPage invoice={invoice} />;
  }

  // 2. Owner One-Click Void Approval Page: /void-approve
  if (currentPath.startsWith('/void-approve')) {
    return <OwnerVoidApprovePage />;
  }

  // 3. Default Cashier Screen: PosPage
  return <PosPage />;
};

export default App;
