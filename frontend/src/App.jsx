import React from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { 
  SingleScraperView, 
  BulkStudioView, 
  ResultsAnalyticsView 
} from './components'
import { useHealth } from './hooks/useHealth'

const queryClient = new QueryClient()

function Navigation() {
  const location = useLocation()
  const { isOnline, isLoading } = useHealth()
  
  const navItems = [
    { path: '/', label: 'Single USN Scraper' },
    { path: '/bulk', label: 'Bulk USN Studio' },
    { path: '/results', label: 'Academic Results & Analytics' }
  ]
  
  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center font-bold text-xl text-blue-600">
              GAT Scraper
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                    location.pathname === item.path
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                isOnline
                  ? 'bg-green-100 text-green-800 border-green-200'
                  : isLoading
                  ? 'bg-slate-100 text-slate-700 border-slate-200'
                  : 'bg-amber-100 text-amber-800 border-amber-200'
              }`}
            >
              <span
                className={`w-2 h-2 mr-1.5 rounded-full ${
                  isOnline ? 'bg-green-500' : isLoading ? 'bg-slate-400' : 'bg-amber-500'
                }`}
              ></span>
              {isOnline ? 'Backend Online' : isLoading ? 'Connecting...' : 'Backend Standby'}
            </span>
          </div>
        </div>
      </div>
    </nav>
  )
}

function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <p className="text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} GAT Results Scraper & Analytics Portal. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="flex flex-col min-h-screen bg-gray-50">
          <Navigation />
          <main className="flex-1 w-full max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <Routes>
              <Route path="/" element={<SingleScraperView />} />
              <Route path="/bulk" element={<BulkStudioView />} />
              <Route path="/results" element={<ResultsAnalyticsView />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </QueryClientProvider>
  )
}

export default App
