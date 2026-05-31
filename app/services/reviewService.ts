/**
 * ============================================================
 * app/services/reviewService.ts
 * ============================================================
 * 정규화된 Supabase VIEW 기반 데이터 조회 서비스
 *
 * 조회 대상:
 *   - normalized_reviews_flat
 *   - normalized_products_flat
 *
 * SQL VIEW에서 JOIN을 완료한 뒤,
 * 기존 UI가 사용하던 Review 구조로 다시 매핑합니다.
 * ============================================================
 */

import { supabase } from "../lib/supabase";
import type { Review, Product, Score } from "../types";

// ----------------------------------------------------------------
// VIEW 이름
// ----------------------------------------------------------------

const REVIEW_VIEW = "normalized_reviews_flat";
const PRODUCT_VIEW = "normalized_products_flat";

// ----------------------------------------------------------------
// 리뷰 VIEW 공통 SELECT
// ----------------------------------------------------------------

const NORMALIZED_REVIEW_SELECT = `
  id,
  review_id,
  product_id,
  brand_name,
  product_name,
  category,
  product_feature,
  source,
  reviewer_type,
  review_text,
  rating,
  review_date,
  sentiment,
  sentiment_score,
  keywords,
  issue_type,
  ai_summary,
  created_at,
  product_description,
  product_price,
  product_updated_at
`.trim();

// ----------------------------------------------------------------
// normalized_reviews_flat VIEW 한 행의 타입
// ----------------------------------------------------------------

type NormalizedReviewFlatRow = {
  id: string;
  review_id: string;
  product_id: string;

  brand_name: string | null;
  product_name: string;
  category: string | null;
  product_feature: string | null;

  source: string | null;
  reviewer_type: string | null;

  review_text: string;
  rating: number;
  review_date: string;

  sentiment: "positive" | "neutral" | "negative";
  sentiment_score: number | null;

  keywords: string[] | null;
  issue_type: string | null;

  ai_summary: string | null;
  created_at: string;

  product_description: string | null;
  product_price: number | null;
  product_updated_at: string | null;
};

// ----------------------------------------------------------------
// VIEW 데이터를 기존 Review 구조로 변환
// ----------------------------------------------------------------

function mapNormalizedReview(row: NormalizedReviewFlatRow): Review {
  return {
    id: row.id,
    review_id: row.review_id,
    product_id: row.product_id,

    source: row.source ?? "",
    reviewer_type: row.reviewer_type ?? "",

    review_text: row.review_text,
    rating: row.rating,
    review_date: row.review_date,

    sentiment: row.sentiment,
    sentiment_score: row.sentiment_score,

    keywords: row.keywords ?? [],
    issue_type: row.issue_type,
    ai_summary: row.ai_summary,
    created_at: row.created_at,

    /**
     * 기존 UI가 review.products.product_name 형태로 접근할 수 있도록
     * 평면형 VIEW 데이터를 제품 객체로 다시 조립합니다.
     */
    products: {
      id: row.product_id,
      brand_name: row.brand_name ?? "",
      product_name: row.product_name,
      category: row.category ?? "",
      product_feature: row.product_feature ?? "",
      description: row.product_description,
      price: row.product_price,
      updated_at: row.product_updated_at,
    },
  };
}

// ----------------------------------------------------------------
// 1. 키워드 기반 리뷰 검색
// ----------------------------------------------------------------

export async function fetchReviewsByKeywords(
  keywords: string[],
  limit: number = 20
): Promise<Review[]> {
  if (!keywords || keywords.length === 0) {
    return fetchLatestReviews(limit);
  }

  const normalizedKeywords = keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);

  if (normalizedKeywords.length === 0) {
    return fetchLatestReviews(limit);
  }

  const orFilter = normalizedKeywords
    .map((keyword) => `review_text.ilike.%${keyword}%`)
    .join(",");

  const { data, error } = await supabase
    .from(REVIEW_VIEW)
    .select(NORMALIZED_REVIEW_SELECT)
    .or(orFilter)
    .order("review_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[reviewService] fetchReviewsByKeywords 오류:",
      error.message
    );
    return [];
  }

  return ((data ?? []) as NormalizedReviewFlatRow[]).map(
    mapNormalizedReview
  );
}

// ----------------------------------------------------------------
// 2. 최신 리뷰 조회
// ----------------------------------------------------------------

export async function fetchLatestReviews(
  limit: number = 20
): Promise<Review[]> {
  const { data, error } = await supabase
    .from(REVIEW_VIEW)
    .select(NORMALIZED_REVIEW_SELECT)
    .order("review_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[reviewService] fetchLatestReviews 오류:",
      error.message
    );
    return [];
  }

  return ((data ?? []) as NormalizedReviewFlatRow[]).map(
    mapNormalizedReview
  );
}

// ----------------------------------------------------------------
// 3. 전체 제품 목록 조회
// ----------------------------------------------------------------

export async function fetchProducts(
  category?: string
): Promise<Product[]> {
  let query = supabase
    .from(PRODUCT_VIEW)
    .select(
      `
        id,
        brand_name,
        product_name,
        category,
        product_feature,
        description,
        price,
        created_at,
        updated_at
      `
    )
    .order("product_name", { ascending: true });

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error(
      "[reviewService] fetchProducts 오류:",
      error.message
    );
    return [];
  }

  return (data as Product[]) ?? [];
}

// ----------------------------------------------------------------
// 4. 특정 제품 리뷰 조회
// ----------------------------------------------------------------

export async function fetchReviewsByProduct(
  productId: string,
  limit: number = 20
): Promise<Review[]> {
  if (!productId) {
    return [];
  }

  const { data, error } = await supabase
    .from(REVIEW_VIEW)
    .select(NORMALIZED_REVIEW_SELECT)
    .eq("product_id", productId)
    .order("review_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[reviewService] fetchReviewsByProduct 오류:",
      error.message
    );
    return [];
  }

  return ((data ?? []) as NormalizedReviewFlatRow[]).map(
    mapNormalizedReview
  );
}

// ----------------------------------------------------------------
// 5. 부정 리뷰 필터링
// ----------------------------------------------------------------

export function filterNegativeReviews(
  reviews: Review[]
): Review[] {
  return reviews.filter(
    (review) =>
      review.sentiment === "negative" ||
      review.rating <= 2
  );
}

// ----------------------------------------------------------------
// 6. 속성 점수 계산
// ----------------------------------------------------------------

export function calculateScores(
  reviews: Review[]
): Score[] {
  const attributes: {
    label: string;
    keywords: string[];
    issueTypes: string[];
  }[] = [
    {
      label: "성분 / 트러블",
      keywords: [
        "트러블",
        "성분",
        "붉은기",
        "여드름",
        "좁쌀",
        "따가움",
        "자극",
      ],
      issueTypes: ["트러블", "성분", "자극"],
    },
    {
      label: "제형 / 발림성",
      keywords: [
        "발림성",
        "제형",
        "흡수",
        "촉촉",
        "텍스처",
        "밀림",
        "끈적",
      ],
      issueTypes: ["발림성", "제형"],
    },
    {
      label: "용기 / 디자인",
      keywords: [
        "용기",
        "디자인",
        "패키지",
        "포장",
        "뚜껑",
        "불량",
      ],
      issueTypes: ["용기불량", "용기", "디자인"],
    },
  ];

  return attributes.map(({ label, keywords, issueTypes }) => {
    const relatedReviews = reviews.filter((review) => {
      if (
        review.issue_type &&
        issueTypes.some((type) =>
          review.issue_type!.includes(type)
        )
      ) {
        return true;
      }

      return keywords.some((keyword) =>
        review.review_text
          ?.toLowerCase()
          .includes(keyword.toLowerCase())
      );
    });

    if (relatedReviews.length === 0) {
      return {
        label,
        value: 50,
        max: 100,
      };
    }

    const averageScore =
      relatedReviews.reduce((sum, review) => {
        if (
          review.sentiment_score !== null &&
          review.sentiment_score !== undefined
        ) {
          return sum + Number(review.sentiment_score);
        }

        return sum + (review.rating - 1) / 4;
      }, 0) / relatedReviews.length;

    const score = Math.round(averageScore * 100);

    return {
      label,
      value: Math.max(1, Math.min(100, score)),
      max: 100,
    };
  });
}