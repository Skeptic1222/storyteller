# Storyteller - Comprehensive API Cost Analysis

*Last Updated: December 2025*

## Executive Summary

This document provides a detailed breakdown of all API costs for the Storyteller application, enabling accurate subscription pricing decisions to ensure profitability.

---

## 1. ElevenLabs Text-to-Speech Costs

### Current Plan: Creator ($22/month)

| Feature | Included | Overage Rate |
|---------|----------|--------------|
| Monthly Credits | 100,000 | - |
| Highest Quality TTS | ~100 min | $0.30/1,000 chars |
| Turbo/Flash TTS | ~200 min | $0.15/1,000 chars |
| Concurrency | 5 simultaneous | - |
| Custom Voices | 30 | - |
| Professional Voice Cloning | 1 PVC | - |
| Commercial License | Yes | - |

### All ElevenLabs Plans Comparison

| Plan | Monthly | Annual | Credits | ~Minutes | Overage (Turbo) |
|------|---------|--------|---------|----------|-----------------|
| Free | $0 | - | 10,000 | ~10 min | N/A |
| Starter | $5 | $4.17/mo | 30,000 | ~30 min | $0.15/1K |
| **Creator** | **$22** | **$18.33/mo** | **100,000** | **~100 min** | **$0.15/1K** |
| Pro | $99 | $82.50/mo | 500,000 | ~500 min | $0.15/1K |
| Scale | $330 | $275/mo | 2,000,000 | ~2,000 min | $0.15/1K |
| Business | $1,320 | $1,100/mo | 11,000,000 | ~11,000 min | Custom |

### Credit-to-Audio Conversion
- **1 credit = 1 character of text**
- **~1,000 characters = ~1 minute of audio** (at ~150 words/minute speaking rate)
- Average word length: ~5 characters + spaces = ~6.5 chars/word

### Cost Per Story (Using Turbo/Flash - Recommended)

| Story Duration | Words | Characters | Credits | Cost (Included) | Cost (Overage) |
|----------------|-------|------------|---------|-----------------|----------------|
| 5 minutes | 750 | 5,000 | 5,000 | $1.10 | $0.75 |
| 10 minutes | 1,500 | 10,000 | 10,000 | $2.20 | $1.50 |
| 15 minutes | 2,250 | 15,000 | 15,000 | $3.30 | $2.25 |
| 20 minutes | 3,000 | 20,000 | 20,000 | $4.40 | $3.00 |
| 30 minutes | 4,500 | 30,000 | 30,000 | $6.60 | $4.50 |
| 60 minutes | 9,000 | 60,000 | 60,000 | $13.20 | $9.00 |

*Cost (Included) = proportional share of $22 base subscription*
*Cost (Overage) = actual overage billing at $0.15/1,000 chars*

---

## 2. OpenAI API Costs

### Model Pricing (December 2025)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Best For |
|-------|----------------------|------------------------|----------|
| GPT-4 | $30.00 | $60.00 | Legacy |
| GPT-4o | $2.50 | $10.00 | High-quality stories |
| **GPT-4o-mini** | **$0.15** | **$0.60** | **Cost-optimized** |
| GPT-4o (cached) | $1.25 | $10.00 | Repeated contexts |

### Token Budget Per Story Session

Based on our multi-agent architecture:

| Agent | Input Tokens | Output Tokens | Model | Cost/Call |
|-------|--------------|---------------|-------|-----------|
| Story Planner | 1,000 | 1,500 | GPT-4o-mini | $0.0011 |
| Lore Agent | 800 | 400 | GPT-4o-mini | $0.0004 |
| Scene Writer (x5-10 scenes) | 1,200 | 800 | GPT-4o-mini | $0.0007/scene |
| Narration Director | 500 | 200 | GPT-4o-mini | $0.0002 |
| Safety Agent | 600 | 100 | GPT-4o-mini | $0.0002 |
| CYOA Manager (if enabled) | 800 | 400 | GPT-4o-mini | $0.0004 |
| Devil's Advocate | 500 | 300 | GPT-4o-mini | $0.0003 |

### Total OpenAI Cost Per Story

| Story Length | Scenes | Total Input | Total Output | **Total Cost** |
|--------------|--------|-------------|--------------|----------------|
| 5 min | 3 | ~6,000 | ~3,500 | **$0.003** |
| 15 min | 7 | ~12,000 | ~7,000 | **$0.006** |
| 30 min | 12 | ~20,000 | ~12,000 | **$0.010** |
| 60 min | 20 | ~35,000 | ~20,000 | **$0.017** |

**Note**: OpenAI costs are negligible compared to ElevenLabs TTS costs (typically < 1% of total).

---

## 3. Whisper Transcription Costs (Voice Input)

### OpenAI Whisper API Pricing

| Model | Cost per Minute | Cost per Hour |
|-------|-----------------|---------------|
| Whisper (legacy) | $0.006 | $0.36 |
| GPT-4o Transcribe | $0.006 | $0.36 |
| GPT-4o Mini Transcribe | $0.003 | $0.18 |

### Estimated Voice Input Usage Per Session

| Activity | Duration | Cost (Whisper) | Cost (Mini) |
|----------|----------|----------------|-------------|
| Story configuration | 1-2 min | $0.006-$0.012 | $0.003-$0.006 |
| CYOA voice commands (per choice) | 5-10 sec | $0.001 | $0.0005 |
| Full voice-interactive session | 5 min | $0.030 | $0.015 |

**Note**: Our architecture uses a local Whisper service (port 3003), which has **zero per-call cost** after server setup. Only applies if switching to OpenAI's hosted API.

---

## 4. Total Cost Per Story (All Services)

### Using Current Setup (Creator Plan + GPT-4o-mini + Local Whisper)

| Story Duration | ElevenLabs | OpenAI | Whisper | **Total Cost** |
|----------------|------------|--------|---------|----------------|
| 5 min | $0.75-$1.10 | $0.003 | $0 | **$0.75-$1.10** |
| 15 min | $2.25-$3.30 | $0.006 | $0 | **$2.26-$3.31** |
| 30 min | $4.50-$6.60 | $0.010 | $0 | **$4.51-$6.61** |
| 60 min | $9.00-$13.20 | $0.017 | $0 | **$9.02-$13.22** |

*Lower bound = overage pricing; Upper bound = proportional included credits*

---

## 5. Monthly Capacity Analysis

### Creator Plan ($22/month) - Maximum Stories

| Story Duration | Max Stories (Included) | Stories Before Overage |
|----------------|------------------------|------------------------|
| 5 min | 20 stories | 20 |
| 15 min | 6-7 stories | 6 |
| 30 min | 3 stories | 3 |
| 60 min | 1-2 stories | 1 |

### Break-Even Analysis

**Fixed Costs:**
- ElevenLabs Creator: $22/month
- Server hosting: ~$0 (existing IIS infrastructure)
- Domain/SSL: ~$1/month amortized

**Variable Costs (per story at overage rates):**
- 15-min story: $2.26
- 30-min story: $4.51

---

## 6. Subscription Pricing Recommendations

### Option A: Tiered Credit System

| Tier | Price | Story Minutes | Cost to You | Margin |
|------|-------|---------------|-------------|--------|
| Free Trial | $0 | 10 min (one 10-min story) | $1.50 | -100% |
| Dreamer | $4.99/mo | 30 min | $4.50 | 10% |
| Storyteller | $9.99/mo | 75 min | $11.25 | -11% |
| Bard | $14.99/mo | 120 min | $18.00 | -17% |
| Unlimited* | $24.99/mo | 200 min soft cap | ~$30.00 | -17% |

*"Unlimited" requires fair use policy and potential throttling*

**Problem**: At current pricing, margins are negative or very thin.

### Option B: Per-Story Pricing (Pay-As-You-Go)

| Story Duration | Price | Cost | Margin |
|----------------|-------|------|--------|
| 5 min | $1.99 | $0.75 | 62% |
| 15 min | $3.99 | $2.26 | 43% |
| 30 min | $6.99 | $4.51 | 35% |
| 60 min | $11.99 | $9.02 | 25% |

**Pros**: Profitable at all tiers, fair usage
**Cons**: Users prefer predictable subscription pricing

### Option C: Hybrid Model (RECOMMENDED)

| Tier | Price | Includes | Additional Stories |
|------|-------|----------|-------------------|
| Free | $0 | 1 story (5 min) | - |
| Basic | $6.99/mo | 3 stories (15 min each) | $2.99/story |
| Standard | $12.99/mo | 8 stories (15 min each) | $2.49/story |
| Premium | $19.99/mo | 15 stories (15 min each) | $1.99/story |
| Family | $29.99/mo | 25 stories + 3 profiles | $1.99/story |

**Margin Analysis (Standard Tier):**
- Revenue: $12.99
- Cost: 8 x $2.26 = $18.08
- Margin: -$5.09 (need higher pricing or lower usage)

### Option D: Adjusted Hybrid (PROFITABLE)

| Tier | Price | Stories | Avg Duration | Cost | Margin |
|------|-------|---------|--------------|------|--------|
| Lite | $7.99/mo | 4 | 10 min | $6.00 | 25% |
| Standard | $14.99/mo | 8 | 10 min | $12.00 | 20% |
| Premium | $24.99/mo | 15 | 12 min | $21.60 | 14% |
| Family | $34.99/mo | 25 | 10 min | $30.00 | 14% |

**Key Adjustments:**
1. Default to shorter stories (10 min vs 15 min)
2. Higher price points
3. Encourage Turbo/Flash voices (half the cost)

---

## 7. Cost Optimization Strategies

### Immediate Optimizations

1. **Use Turbo/Flash Models**: 50% cost reduction vs highest quality
2. **Default to 10-minute stories**: Sweet spot for bedtime, lower cost
3. **Cache common phrases**: Reduce regeneration of standard content
4. **Batch TTS requests**: Stay under concurrency limits

### Scaling Strategies

| Users | Recommended Plan | Monthly Cost | Per-User Cost |
|-------|------------------|--------------|---------------|
| 1-20 | Creator ($22) | $22 | $1.10-$22.00 |
| 20-100 | Pro ($99) | $99 | $0.99-$4.95 |
| 100-500 | Scale ($330) | $330 | $0.66-$3.30 |
| 500+ | Business ($1,320) | $1,320+ | $2.64+ |

### Volume Pricing Thresholds

To be profitable at **$9.99/month** per user with **8 stories/month**:
- Need overage rate economics
- Must reach **Pro plan** ($99/month) to serve ~44 users profitably
- At **Scale** ($330/month): ~146 users to break even

---

## 8. Competitor Pricing Reference

| Competitor | Price | Offering |
|------------|-------|----------|
| Oscar Stories | Free (limited) | AI bedtime stories, no audio |
| Bedtimestory.ai | Free-$9.99 | Personalized stories |
| NovelAI | $10-$25/mo | Text-only story generation |
| Audible | $14.95/mo | 1 audiobook credit |
| SleepyTales | ~$4.99/mo | Basic AI stories |

**Our Differentiator**: Full audio narration + voice input + CYOA + multi-agent quality

---

## 9. Recommended Launch Pricing

### Phase 1: Beta Launch (First 100 Users)

| Tier | Price | Includes |
|------|-------|----------|
| Beta Access | $4.99/mo | 5 stories, 10 min each |

*Purpose: Validate demand, gather feedback, subsidize with creator plan*

### Phase 2: Public Launch

| Tier | Price | Stories | Minutes | Profiles |
|------|-------|---------|---------|----------|
| Dreamer | $7.99 | 5 | 50 total | 1 |
| Storyteller | $14.99 | 12 | 120 total | 2 |
| Family | $24.99 | 25 | 250 total | 5 |

### Phase 3: At Scale (1000+ users)

Negotiate enterprise ElevenLabs pricing and optimize for volume.

---

## 10. Key Takeaways

1. **ElevenLabs TTS is 95%+ of variable costs** - Optimize here first
2. **OpenAI costs are negligible** - GPT-4o-mini is incredibly cheap
3. **Break-even requires ~$2.50/story** at minimum
4. **Profitable subscription needs ~$15+/month** for typical usage
5. **Per-story pricing is more sustainable** than unlimited models
6. **Turbo/Flash voices are essential** for cost management

---

## Sources

- [ElevenLabs Pricing](https://elevenlabs.io/pricing)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [FlexPrice ElevenLabs Breakdown](https://flexprice.io/blog/elevenlabs-pricing-breakdown)
- [CostGoat OpenAI Calculator](https://costgoat.com/pricing/openai-api)
