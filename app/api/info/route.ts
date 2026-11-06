import { NextResponse } from "next/server";
import { ARC_TESTNET, GATEWAY } from "@/lib/constants";
import { fetchGatewayInfo } from "@/lib/gateway";
import {
  SAVED_DASHBOARD_EMPTY_STATE,
  SAVED_SUBTITLES,
  isRiverConfigured,
  riverModel,
} from "@/lib/river";
import { getCreator, storageMode } from "@/lib/store";

/** GET /api/info — live Gateway info (Arc domain 26) + app configuration. */
export async function GET() {
  try {
    const info = await fetchGatewayInfo();
    const arc = info.domains.find((d) => d.domain === GATEWAY.domain);
    const creator = await getCreator();
    return NextResponse.json({
      chain: ARC_TESTNET,
      gatewayDomain: GATEWAY.domain,
      tokenSymbol: GATEWAY.tokenSymbol,
      arc: arc
        ? {
            chain: arc.chain,
            network: arc.network,
            domain: arc.domain,
            walletContract: arc.walletContract.address,
            minterContract: arc.minterContract.address,
            supportedTokens: arc.walletContract.supportedTokens,
            processedHeight: arc.processedHeight,
            burnIntentExpirationHeight: arc.burnIntentExpirationHeight,
          }
        : null,
      creatorConfigured: Boolean(creator),
      creatorName: creator?.name ?? null,
      storage: storageMode(),
      riverConfigured: isRiverConfigured(),
      riverModel: riverModel(),
      subtitles: SAVED_SUBTITLES,
      dashboardEmptyState: SAVED_DASHBOARD_EMPTY_STATE,
      realTransferEnabled: Boolean(process.env.CIRCLE_API_KEY),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
