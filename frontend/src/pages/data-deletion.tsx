import Head from 'next/head';

export default function DataDeletion() {
  return (
    <>
      <Head>
        <title>Data Deletion - Jawab24</title>
        <meta name="description" content="How to delete your data from Jawab24" />
      </Head>
      
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Data Deletion Instructions</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-gray-600 mb-6">
              <strong>Last updated:</strong> December 2024
            </p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">How to Delete Your Data</h2>
              <p className="text-gray-700 mb-4">
                If you want to delete your data from Jawab24, you have several options:
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Option 1: Delete from Jawab24</h2>
              <ol className="list-decimal pl-6 text-gray-700 space-y-2">
                <li>Log in to your Jawab24 account at <a href="https://jawab24.com" className="text-blue-600 hover:underline">jawab24.com</a></li>
                <li>Go to <strong>Settings</strong></li>
                <li>Click on <strong>Delete Account</strong></li>
                <li>Confirm the deletion</li>
              </ol>
              <p className="text-gray-700 mt-4">
                This will permanently delete all your data including connected pages, comments, messages, and settings.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Option 2: Remove from Facebook</h2>
              <ol className="list-decimal pl-6 text-gray-700 space-y-2">
                <li>Go to your <a href="https://www.facebook.com/settings?tab=business_tools" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">Facebook Settings → Business Integrations</a></li>
                <li>Find <strong>Jawab24</strong> in the list</li>
                <li>Click <strong>Remove</strong></li>
                <li>Check the box to delete all data</li>
              </ol>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Option 3: Contact Us</h2>
              <p className="text-gray-700 mb-4">
                You can also request data deletion by contacting us directly:
              </p>
              <p className="text-gray-700">
                <strong>Email:</strong> <a href="mailto:aliahdab@gmail.com" className="text-blue-600 hover:underline">aliahdab@gmail.com</a>
              </p>
              <p className="text-gray-700 mt-4">
                Please include your Facebook account email or Page name in your request. 
                We will process your deletion request within 30 days.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">What Data Will Be Deleted?</h2>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>Your account information</li>
                <li>Connected Facebook Pages</li>
                <li>Stored comments and messages</li>
                <li>Reply history</li>
                <li>Business information / Knowledge base</li>
                <li>All settings and preferences</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Data Retention</h2>
              <p className="text-gray-700">
                After deletion, your data will be permanently removed from our servers within 90 days. 
                Some data may be retained in encrypted backups for a limited period for legal compliance.
              </p>
            </section>
          </div>
          
          <div className="mt-8 pt-8 border-t border-gray-200">
            <a href="/" className="text-blue-600 hover:text-blue-800 font-medium">
              ← Back to Jawab24
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

