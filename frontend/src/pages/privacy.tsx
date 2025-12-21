import Head from 'next/head';

export default function PrivacyPolicy() {
  return (
    <>
      <Head>
        <title>Privacy Policy - Jawab24</title>
        <meta name="description" content="Privacy Policy for Jawab24 - Smart Auto-Reply for Facebook Pages" />
      </Head>
      
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
          
          <div className="prose prose-gray max-w-none">
            <p className="text-gray-600 mb-6">
              <strong>Last updated:</strong> December 2024
            </p>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">1. Introduction</h2>
              <p className="text-gray-700 mb-4">
                Jawab24 (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy. 
                This Privacy Policy explains how we collect, use, and safeguard your information when you use our 
                Facebook auto-reply service at jawab24.com.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">2. Information We Collect</h2>
              <p className="text-gray-700 mb-4">When you use Jawab24, we collect:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li><strong>Facebook Account Information:</strong> Your name, email, and profile picture when you log in with Facebook.</li>
                <li><strong>Facebook Page Data:</strong> Information about Pages you manage, including page name, ID, and access tokens.</li>
                <li><strong>Comments and Messages:</strong> Content of comments and messages on your connected Pages to provide auto-reply functionality.</li>
                <li><strong>Business Information:</strong> Any business details you provide to customize AI-generated replies.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">3. How We Use Your Information</h2>
              <p className="text-gray-700 mb-4">We use your information to:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>Provide and maintain our auto-reply service</li>
                <li>Generate intelligent responses to comments and messages</li>
                <li>Improve and personalize our service</li>
                <li>Communicate with you about service updates</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">4. Data Sharing</h2>
              <p className="text-gray-700 mb-4">
                We do not sell your personal information. We may share data with:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li><strong>OpenAI:</strong> Comment/message content is sent to OpenAI to generate replies. This data is processed according to OpenAI&apos;s privacy policy.</li>
                <li><strong>Facebook:</strong> We interact with Facebook&apos;s API to read and respond to comments/messages on your behalf.</li>
                <li><strong>Service Providers:</strong> We use cloud hosting providers to operate our service.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">5. Data Security</h2>
              <p className="text-gray-700 mb-4">
                We implement industry-standard security measures including encryption, secure servers, 
                and access controls to protect your data. However, no method of transmission over the 
                Internet is 100% secure.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">6. Data Retention</h2>
              <p className="text-gray-700 mb-4">
                We retain your data for as long as your account is active or as needed to provide services. 
                You can request deletion of your data at any time by contacting us.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">7. Your Rights</h2>
              <p className="text-gray-700 mb-4">You have the right to:</p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>Access your personal data</li>
                <li>Correct inaccurate data</li>
                <li>Delete your data</li>
                <li>Disconnect your Facebook Pages</li>
                <li>Revoke Facebook permissions at any time</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">8. Facebook Data Deletion</h2>
              <p className="text-gray-700 mb-4">
                To delete your data, you can either:
              </p>
              <ul className="list-disc pl-6 text-gray-700 space-y-2">
                <li>Log into Jawab24 and delete your account from settings</li>
                <li>Remove the Jawab24 app from your Facebook settings</li>
                <li>Contact us at the email below</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">9. Changes to This Policy</h2>
              <p className="text-gray-700 mb-4">
                We may update this Privacy Policy from time to time. We will notify you of any changes 
                by posting the new policy on this page and updating the &quot;Last updated&quot; date.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">10. Contact Us</h2>
              <p className="text-gray-700 mb-4">
                If you have any questions about this Privacy Policy, please contact us at:
              </p>
              <p className="text-gray-700">
                <strong>Email:</strong> aliahdab@gmail.com
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

