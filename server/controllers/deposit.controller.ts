"use server";

import { ethers } from "ethers";
import { depositABI, PROVIDER } from "../ethereum/provider";
import {
  BaseDeposit,
  DepositControllerDto,
  DepositServiceDto,
} from "../domain/deposit.domain";
import {
  CreateDepositsService,
  getAllDepositsService,
} from "../services/deposit/deposit.service";
import { Response } from "../utils/IResponse";
import { sendNotification } from "../utils/telegram_bot";
import { CACHE } from "../lib/cache";
import { faro } from "@grafana/faro-web-sdk";
export async function putDeposit() {
  const depositContract = new ethers.Contract(
    process.env.BEACON_DEPOSIT_CONTRACT_ADDR!,
    depositABI,
    PROVIDER
  );

  depositContract.on(
    "DepositEvent",
    async (pubkey, withdrawal_credentials, amount, signature, index, event) => {
      try {
        if (!event.args) {
          return;
        }
        
        console.log(
          `New deposit - PubKey: ${pubkey}, Amount: ${ethers.formatEther(
            amount
          )}, Index: ${index}`
        );
        const blockNumber = await PROVIDER.getBlockNumber();
        const block = await PROVIDER.getBlock(blockNumber);
        const deposit: DepositServiceDto = {
          blockNumber: blockNumber,
          createdAt: Date.now() as unknown as bigint,
          updatedAt: Date.now() as unknown as bigint,
          blockTimestamp: block?.timestamp || 0,
          fee: block?.baseFeePerGas || (0 as unknown as bigint),
          hash: block?.hash || "",
          pubkey: pubkey,
        };
        //store in db
        const response = await CreateDepositsService([deposit]);
        if (!response.success) {
          console.log({ status: 500, data: "failed", error: response.message });
        }
        CACHE.pop();
        CACHE.push({ data: deposit, exp: Date.now() + 3600 });
        sendNotification(`new transaction received:\nblockNumber: ${deposit.blockNumber}\nblockTimestamp: ${deposit.blockTimestamp}\npubkey:${deposit.pubkey}`);
      } catch (error) {
        console.log(error)
        console.log("some thing went wrong");
      }
    }
  );
}

export async function putAllDeposits() {
  const startBlock = parseInt(process.env.START_BLOCK!); // starting from this transaction
  const depositContract = new ethers.Contract(
    process.env.BEACON_DEPOSIT_CONTRACT_ADDR!,
    depositABI,
    PROVIDER
  );

  // Get the latest block number
  const latestBlock = await PROVIDER.getBlockNumber();

  // Fetch all DepositEvent logs from the contract
  const depositEvents = await depositContract.queryFilter(
    "DepositEvent",
    startBlock,
    latestBlock
  );
  // Process each deposit event

  // Execute all the promises in parallel
  const deposits = [];
  for (const event of depositEvents) {
    const block = await PROVIDER.getBlock(event.blockNumber);

    const { pubkey, withdrawal_credentials, amount, signature, index } =
      //@ts-ignore
      event.args;
    const deposit: DepositServiceDto = {
      blockNumber: event.blockNumber,
      createdAt: Date.now() as unknown as bigint,
      updatedAt: Date.now() as unknown as bigint,
      blockTimestamp: block?.timestamp || 0,
      fee: block?.baseFeePerGas || (0 as unknown as bigint),
      hash: event.transactionHash,
      pubkey: pubkey,
    };
    deposits.push(deposit);
  }

  const response = await CreateDepositsService(deposits);
  if (!response.success) {
    return { status: 500, data: "failed", error: response.message };
  }

  return { status: 201, data: "ok" };
}

export async function getAllDeposits(
  start: number,
  size: number
): Promise<Response<BaseDeposit[]>> {
  const response = await getAllDepositsService(start, size);
  if (!response.success) {
    return {
      success: false,
      message: "failed to get deposits",
      statusCode: 500,
    };
  }

  return { success: true, data: response.data, statusCode: 201 };
}

export async function getRealtimeDeposits(): Promise<Response<BaseDeposit>> {
  return { success: true, statusCode: 200, data: { ...CACHE[0].data, id: 0 } };
}
