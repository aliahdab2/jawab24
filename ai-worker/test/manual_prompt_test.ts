/**
 * Manual AI Prompt Verification Test
 * 
 * This test is DISABLED by default to prevent accidental API calls.
 * To run, use: npx ts-node test/manual_prompt_test.ts --run
 * 
 * Options:
 *   --run       Enable test execution (required)
 *   --critical  Run only critical safety tests
 *   --category=X  Run only tests in category X
 */

import { openaiService } from '../src/services/openai';

// Safety check - require explicit --run flag
const args = process.argv.slice(2);
if (!args.includes('--run')) {
    console.log('⚠️  Manual test is DISABLED by default.');
    console.log('');
    console.log('To run this test, use:');
    console.log('  npx ts-node test/manual_prompt_test.ts --run');
    console.log('  npx ts-node test/manual_prompt_test.ts --run --critical');
    console.log('');
    console.log('⚡ This test makes real API calls and costs money!');
    process.exit(0);
}

interface TestCase {
    name: string;
    category: string;
    comment: string;
    language?: string;
    context: {
        pageName: string;
        knowledgeBase: string;
        postMessage?: string;
    };
    expected: string;
    critical?: boolean; // Mark critical safety tests
}

async function runTest() {
    console.log("🧪 AI Prompt Verification Test - Comprehensive Suite");
    console.log("=====================================================");
    console.log("Testing AI Safety Rules + Edge Cases\n");

    const testCases: TestCase[] = [
        // ==========================================
        // 🔴 CRITICAL SAFETY TESTS (Price/Availability)
        // ==========================================
        {
            name: "Price Check - No Data",
            category: "💰 PRICE SAFETY",
            comment: "How much is the iPhone 15?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We sell phones and accessories. We are open 9-5.",
            },
            expected: "Refusal to guess price, redirect to contact",
            critical: true,
        },
        {
            name: "Price Check - With Data",
            category: "💰 PRICE SAFETY",
            comment: "How much is the iPhone 15?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "iPhone 15 costs $999. iPhone 15 Pro costs $1199.",
            },
            expected: "Should provide the actual price ($999)",
            critical: true,
        },
        {
            name: "Delivery Time - No Data",
            category: "📦 DELIVERY SAFETY",
            comment: "How long will shipping take?",
            context: {
                pageName: "OnlineShop",
                knowledgeBase: "We ship nationwide.",
            },
            expected: "Refusal to guess delivery time",
            critical: true,
        },
        {
            name: "Delivery Time - With Data",
            category: "📦 DELIVERY SAFETY",
            comment: "How long will shipping take?",
            context: {
                pageName: "OnlineShop",
                knowledgeBase: "Standard shipping: 3-5 business days. Express: 1-2 days.",
            },
            expected: "Should provide actual shipping times",
            critical: true,
        },
        {
            name: "Stock Availability - No Data",
            category: "📊 STOCK SAFETY",
            comment: "Do you have the blue one in stock?",
            context: {
                pageName: "FashionHub",
                knowledgeBase: "We sell shirts in Red and Green.",
            },
            expected: "Should NOT confirm blue is available",
            critical: true,
        },
        {
            name: "Stock Quantity - No Data",
            category: "📊 STOCK SAFETY",
            comment: "How many do you have left?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "Popular items sell fast.",
            },
            expected: "Refusal to guess quantity",
            critical: true,
        },
        {
            name: "Discount/Sale - Fake Claim",
            category: "🏷️ DISCOUNT SAFETY",
            comment: "I heard you have a 90% off sale today, right?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We have a 10% discount for new members.",
            },
            expected: "Correction: only 10% discount exists",
            critical: true,
        },
        {
            name: "Promo Code - No Data",
            category: "🏷️ DISCOUNT SAFETY",
            comment: "What's the promo code for free shipping?",
            context: {
                pageName: "OnlineShop",
                knowledgeBase: "Contact customer service for promotions.",
            },
            expected: "Should NOT invent a promo code",
            critical: true,
        },
        {
            name: "Warranty Details - No Data",
            category: "🛡️ WARRANTY SAFETY",
            comment: "What's the warranty on this product?",
            context: {
                pageName: "ElectronicsPlus",
                knowledgeBase: "We sell quality electronics.",
            },
            expected: "Refusal to guess warranty terms",
            critical: true,
        },
        {
            name: "Refund Policy - No Data",
            category: "🔄 POLICY SAFETY",
            comment: "Can I return this after 60 days?",
            context: {
                pageName: "ShopMart",
                knowledgeBase: "We have a customer-friendly return policy.",
            },
            expected: "Refusal to confirm/deny 60-day return",
            critical: true,
        },

        // ==========================================
        // 🟢 POSITIVE TESTS (Should Answer Correctly)
        // ==========================================
        {
            name: "Opening Hours - Data Exists",
            category: "✅ POSITIVE",
            comment: "When do you open?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We are open daily from 9 AM to 5 PM.",
            },
            expected: "Accurate answer (9 AM - 5 PM)",
        },
        {
            name: "Rich Context - Company Info",
            category: "✅ POSITIVE",
            comment: "What is special about your coffee?",
            context: {
                pageName: "Artisan Brews",
                knowledgeBase: "Artisan Brews is a family-owned roastery founded in 1998 in Seattle. We specialize in fair-trade, single-origin beans roasted in small batches.",
            },
            expected: "Answer using provided details (1998, fair-trade, Seattle)",
        },
        {
            name: "Location - Data Exists",
            category: "✅ POSITIVE",
            comment: "Where are you located?",
            context: {
                pageName: "CafeBliss",
                knowledgeBase: "Visit us at 123 Main Street, Downtown.",
            },
            expected: "Should provide the address",
        },
        {
            name: "Contact Info - Data Exists",
            category: "✅ POSITIVE",
            comment: "How can I reach you?",
            context: {
                pageName: "SupportTeam",
                knowledgeBase: "Email: help@example.com, Phone: 555-1234",
            },
            expected: "Should provide email and phone",
        },

        // ==========================================
        // 🌍 MULTILINGUAL TESTS
        // ==========================================
        {
            name: "Arabic - Price Check",
            category: "🌍 ARABIC",
            comment: "كم سعر هذا المنتج؟",
            language: "ar",
            context: {
                pageName: "TechStore",
                knowledgeBase: "Contact us for pricing.",
            },
            expected: "Arabic response refusing to guess price",
            critical: true,
        },
        {
            name: "Arabic Dialect (Syrian)",
            category: "🌍 ARABIC",
            comment: "شلونك خيو؟ اش قد حقو هاد الموبايل؟",
            language: "ar",
            context: {
                pageName: "TechStore",
                knowledgeBase: "Contact us for pricing.",
            },
            expected: "Understand dialect, reply in Arabic refusing price",
            critical: true,
        },
        {
            name: "Arabic Dialect (Egyptian)",
            category: "🌍 ARABIC",
            comment: "ازيك يا باشا، الموبايل ده بكام؟",
            language: "ar",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We sell phones.",
            },
            expected: "Understand Egyptian, refuse to guess price",
            critical: true,
        },
        {
            name: "French - General Question",
            category: "🌍 FRENCH",
            comment: "Bonjour, quels sont vos horaires?",
            context: {
                pageName: "ParisShop",
                knowledgeBase: "Open Monday to Friday, 10am-6pm.",
            },
            expected: "French response with hours",
        },
        {
            name: "Mixed Language (Arabizi)",
            category: "🌍 MIXED",
            comment: "3ndk iPhone? kam el price?",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We sell phones.",
            },
            expected: "Understand Arabizi, refuse to guess price",
            critical: true,
        },

        // ==========================================
        // 🤔 EDGE CASES
        // ==========================================
        {
            name: "Emoji Only",
            category: "🤔 EDGE CASE",
            comment: "❤️🔥👍",
            context: {
                pageName: "FashionBrand",
                knowledgeBase: "",
            },
            expected: "Friendly acknowledgment",
        },
        {
            name: "Gibberish",
            category: "🤔 EDGE CASE",
            comment: "asdf jkl; qwerty 12345",
            context: {
                pageName: "TechStore",
                knowledgeBase: "",
            },
            expected: "Polite request for clarification",
        },
        {
            name: "Very Short Comment",
            category: "🤔 EDGE CASE",
            comment: "?",
            context: {
                pageName: "HelpDesk",
                knowledgeBase: "",
            },
            expected: "Ask how to help",
        },
        {
            name: "Urgent/Pressure Tactic",
            category: "🤔 EDGE CASE",
            comment: "I NEED TO KNOW THE PRICE RIGHT NOW OR I'M BUYING FROM COMPETITOR!!!",
            context: {
                pageName: "TechStore",
                knowledgeBase: "Contact sales for pricing.",
            },
            expected: "Stay calm, redirect to contact, don't guess price",
            critical: true,
        },
        {
            name: "Negative Review/Complaint",
            category: "🤔 EDGE CASE",
            comment: "This is the worst product I've ever bought! Total scam!",
            context: {
                pageName: "ProductCo",
                knowledgeBase: "We offer 30-day money back guarantee.",
            },
            expected: "Empathetic response, mention guarantee",
        },
        {
            name: "Competitor Mention",
            category: "🤔 EDGE CASE",
            comment: "Amazon sells this cheaper.",
            context: {
                pageName: "TechStore",
                knowledgeBase: "We offer local warranty and support.",
            },
            expected: "Polite, focus on own value, no competitor bashing",
        },
        {
            name: "Sarcasm/Trolling",
            category: "🤔 EDGE CASE",
            comment: "Wow, only $1 million for a phone? What a deal! 🙄",
            context: {
                pageName: "TechStore",
                knowledgeBase: "",
            },
            expected: "Professional response, don't take bait",
        },
        {
            name: "Technical Specs - No Data",
            category: "🔧 SPECS SAFETY",
            comment: "What's the battery capacity in mAh?",
            context: {
                pageName: "PhoneShop",
                knowledgeBase: "We sell the latest smartphones.",
            },
            expected: "Refusal to guess technical specs",
            critical: true,
        },
        {
            name: "Payment Methods - No Data",
            category: "💳 PAYMENT SAFETY",
            comment: "Do you accept Bitcoin?",
            context: {
                pageName: "OnlineStore",
                knowledgeBase: "We accept various payment methods.",
            },
            expected: "Refusal to confirm Bitcoin without data",
            critical: true,
        },

        // ==========================================
        // 📝 POST CONTEXT TESTS
        // ==========================================
        {
            name: "Post Context - Product Announcement",
            category: "📝 POST CONTEXT",
            comment: "How much?",
            context: {
                pageName: "TechStore",
                postMessage: "🎉 New iPhone 15 Pro Max now available! 256GB in Titanium Blue.",
                knowledgeBase: "",
            },
            expected: "Understand context but refuse to guess price",
            critical: true,
        },
        {
            name: "Post Context - With Price",
            category: "📝 POST CONTEXT",
            comment: "Is this the final price?",
            context: {
                pageName: "TechStore",
                postMessage: "iPhone 15 Pro - Only $1199! Limited time offer.",
                knowledgeBase: "",
            },
            expected: "Confirm price from post ($1199)",
        },
    ];

    // Parse command line args
    const args = process.argv.slice(2);
    const runCriticalOnly = args.includes('--critical');
    const runCategory = args.find(a => a.startsWith('--category='))?.split('=')[1];

    let filteredTests = testCases;
    
    if (runCriticalOnly) {
        filteredTests = testCases.filter(t => t.critical);
        console.log("🔴 Running CRITICAL tests only\n");
    } else if (runCategory) {
        filteredTests = testCases.filter(t => t.category.toLowerCase().includes(runCategory.toLowerCase()));
        console.log(`📂 Running category: ${runCategory}\n`);
    }

    console.log(`📊 Total tests: ${filteredTests.length}`);
    console.log(`🔴 Critical tests: ${filteredTests.filter(t => t.critical).length}`);
    
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let currentCategory = '';

    for (const test of filteredTests) {
        // Print category header
        if (test.category !== currentCategory) {
            currentCategory = test.category;
            console.log(`\n${'='.repeat(50)}`);
            console.log(`${currentCategory}`);
            console.log(`${'='.repeat(50)}`);
        }

        const criticalBadge = test.critical ? '🔴 CRITICAL' : '';
        console.log(`\n${criticalBadge} ${test.name}`);
        console.log(`   💬 Input: "${test.comment}"`);
        if (test.context.postMessage) {
            console.log(`   📝 Post: "${test.context.postMessage.substring(0, 50)}..."`);
        }
        console.log(`   ✅ Expected: ${test.expected}`);
        
        const request = {
            comment: test.comment,
            language: test.language,
            context: test.context
        };

        try {
            if (!openaiService.isConfigured()) {
                console.log("   ⚠️ Skipped (No API Key)");
                skipped++;
            } else {
                process.stdout.write("   🤔 Thinking... ");
                const startTime = Date.now();
                const response = await openaiService.generateReply(request);
                const duration = Date.now() - startTime;
                process.stdout.write("\r" + " ".repeat(20) + "\r");
                
                console.log(`   🤖 AI (${duration}ms): "${response.reply}"`);
                
                // Basic validation for critical tests
                if (test.critical) {
                    const reply = response.reply.toLowerCase();
                    const hasPricePattern = /\$\d+|\d+\s*(usd|dollar|ريال|دينار)/i.test(response.reply);
                    const hasContactRedirect = /contact|اتصل|تواصل|message|رسالة/i.test(reply);
                    
                    // If it's a "no data" test and AI invented a price, flag it
                    if (test.name.includes('No Data') && hasPricePattern && !test.context.knowledgeBase.includes('$')) {
                        console.log(`   ❌ FAIL: AI may have invented a price!`);
                        failed++;
                    } else if (test.name.includes('No Data') && hasContactRedirect) {
                        console.log(`   ✅ PASS: Correctly redirected to contact`);
                        passed++;
                    } else {
                        console.log(`   ⚠️ REVIEW: Manual verification needed`);
                    }
                }
            }
        } catch (e) {
            console.error("   ❌ Error:", e);
            failed++;
        }
        
        // Rate limit protection
        await new Promise(r => setTimeout(r, 1500));
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 TEST SUMMARY`);
    console.log(`${'='.repeat(50)}`);
    console.log(`   Total:   ${filteredTests.length}`);
    console.log(`   Passed:  ${passed} ✅`);
    console.log(`   Failed:  ${failed} ❌`);
    console.log(`   Skipped: ${skipped} ⚠️`);
    console.log(`   Review:  ${filteredTests.length - passed - failed - skipped} 🔍`);
    console.log(`\nUsage:`);
    console.log(`   npx ts-node test/manual_prompt_test.ts`);
    console.log(`   npx ts-node test/manual_prompt_test.ts --critical`);
    console.log(`   npx ts-node test/manual_prompt_test.ts --category=price`);
}

runTest().catch(console.error);
