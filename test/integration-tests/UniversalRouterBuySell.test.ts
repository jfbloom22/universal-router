import {
  UniversalRouter,
  Permit2,
  ERC20,
  IWETH9,
  MockLooksRareRewardsDistributor,
  ERC721,
  ERC1155,
} from '../../typechain'
import { BigNumber, BigNumberish } from 'ethers'
import { Pair } from '@uniswap/v2-sdk'
import { expect } from './shared/expect'
import { abi as ROUTER_ABI } from '../../artifacts/contracts/UniversalRouter.sol/UniversalRouter.json'
import { abi as TOKEN_ABI } from '../../artifacts/solmate/src/tokens/ERC20.sol/ERC20.json'
import { abi as WETH_ABI } from '../../artifacts/contracts/interfaces/external/IWETH9.sol/IWETH9.json'

import NFTX_ZAP_ABI from './shared/abis/NFTXZap.json'
import deployUniversalRouter, { deployPermit2 } from './shared/deployUniversalRouter'
import {
  ADDRESS_THIS,
  ALICE_ADDRESS,
  DEADLINE,
  OPENSEA_CONDUIT_KEY,
  ROUTER_REWARDS_DISTRIBUTOR,
  SOURCE_MSG_SENDER,
  MAX_UINT160,
  MAX_UINT,
  ETH_ADDRESS,
  NFTX_MILADY_VAULT_ID,
} from './shared/constants'
import {
  seaportInterface,
  getAdvancedOrderParams,
  AdvancedOrder,
  Order,
  seaportV1_4Orders,
  seaportV1_5Orders,
} from './shared/protocolHelpers/seaport'
import { resetFork, WETH, DAI, MILADY_721, TOWNSTAR_1155 } from './shared/mainnetForkHelpers'
import { CommandType, RoutePlanner } from './shared/planner'
import { makePair } from './shared/swapRouter02Helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expandTo18DecimalsBN } from './shared/helpers'
import hre from 'hardhat'
import { findCustomErrorSelector } from './shared/parseEvents'
import { getPermitSignature } from './shared/protocolHelpers/permit2'

const { ethers } = hre
const nftxZapInterface = new ethers.utils.Interface(NFTX_ZAP_ABI)
const routerInterface = new ethers.utils.Interface(ROUTER_ABI)
const PERMIT_EXPIRATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const PERMIT_SIG_EXPIRATION = 30 * 60 * 1000; // 30 minutes in milliseconds


describe('UniversalRouterBuySell', () => {
  let alice: SignerWithAddress
  let router: UniversalRouter
  let permit2: Permit2
  let daiContract: ERC20
  let wethContract: IWETH9
  let townStarNFT: ERC1155

  describe('#execute', () => {
    let planner: RoutePlanner

    beforeEach(() => {
      planner = new RoutePlanner()
    })

    describe('ERC20 --> NFT', () => {
      let advancedOrder: AdvancedOrder
      let value: BigNumber

      beforeEach(async () => {
        await resetFork(17179617)
        alice = await ethers.getSigner(ALICE_ADDRESS)
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [ALICE_ADDRESS],
        })
        daiContract = new ethers.Contract(DAI.address, TOKEN_ABI, alice) as ERC20
        wethContract = new ethers.Contract(WETH.address, WETH_ABI, alice) as IWETH9
        permit2 = (await deployPermit2()).connect(alice) as Permit2
        router = (await deployUniversalRouter(permit2)).connect(alice) as UniversalRouter
        townStarNFT = TOWNSTAR_1155.connect(alice) as ERC1155
        ;({ advancedOrder, value } = getAdvancedOrderParams(seaportV1_5Orders[0]))
        await daiContract.approve(permit2.address, MAX_UINT)
        await wethContract.approve(permit2.address, MAX_UINT)
        await permit2.approve(DAI.address, router.address, MAX_UINT160, DEADLINE)
        await permit2.approve(WETH.address, router.address, MAX_UINT160, DEADLINE)
      })

      it('completes a trade for ETH --> WETH --> ERC20', async () => {
        const balanceOfDaiBefore = await daiContract.balanceOf(alice.address)
        const minAmountOut = ethers.utils.parseEther('0.000000000000001');

        const wethAmount = ethers.utils.parseEther('1')
        const daiAmountBefore = await daiContract.balanceOf(alice.address)
        console.log('daiAmountBefore', daiAmountBefore)
        

        planner.addCommand(CommandType.WRAP_ETH, [router.address, wethAmount])
        planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
          alice.address,
          wethAmount,
          minAmountOut,
          [WETH.address, DAI.address],
          SOURCE_MSG_SENDER,
        ])
        // planner.addCommand(CommandType.PERMIT2_PERMIT, [
        //   {
        //     details: {
        //       token: DAI.address,
        //       amount: MAX_UINT160,
        //       expiration: PERMIT_EXPIRATION, // expiration of 0 is block.timestamp
        //       nonce: 0, // this is the first trade
        //     },
        //     spender: router.address,
        //     sigDeadline: DEADLINE,
        //   },
        //   await getPermitSignature(
        //     {
        //       details: {
        //         token: DAI.address,
        //         amount: wethAmount,
        //         expiration: PERMIT_SIG_EXPIRATION,
        //         nonce: 0,
        //       },
        //       spender: router.address,
        //       sigDeadline: DEADLINE,
        //     },
        //     alice,
        //     permit2
        //   ),
        // ])
        const amountAfterFirstSwap = await daiContract.balanceOf(alice.address)
        // swap dai to weth
        planner.addCommand(CommandType.V2_SWAP_EXACT_OUT, [
          alice.address,
          wethAmount,
          MAX_UINT,
          [DAI.address, WETH.address],
          SOURCE_MSG_SENDER,
        ])

        const { commands, inputs } = planner
        const result = await router['execute(bytes,bytes[],uint256)'](commands, inputs, DEADLINE, {value: wethAmount})
        await result.wait()
        const amountAfterSecondSwap = await daiContract.balanceOf(alice.address)
        console.log('amountAfterSecondSwap', amountAfterSecondSwap)
        console.log('amountAfterFirstSwap', amountAfterFirstSwap)
        expect(amountAfterSecondSwap).to.not.eq(balanceOfDaiBefore)
        expect(amountAfterSecondSwap).to.not.eq(amountAfterFirstSwap)
      })
     
    })

  })
})