// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IAssetRegistry, IAuditRegistry, IIdentityRegistry, IRwaShareToken, ProjectState
} from "../interfaces/IRoboShare.sol";
import {RwaShareToken} from "../token/RwaShareToken.sol";
import {OfferingManager} from "../offering/OfferingManager.sol";
import {SubscriptionRouter} from "../offering/SubscriptionRouter.sol";
import {RevenueDistributor} from "../distribution/RevenueDistributor.sol";
import {FeeTiers} from "../libraries/FeeTiers.sol";

/// @notice Each deployer embeds one contract's creation code so ProjectFactory stays under the
/// EIP-170 size limit. Deployers are permissionless: a contract they create is inert until
/// ProjectFactory links it in the AssetRegistry.
contract TokenDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        bytes32 projectId,
        IAssetRegistry assetRegistry,
        IIdentityRegistry identityRegistry,
        address admin,
        address pauser
    ) external returns (address) {
        return address(
            new RwaShareToken(
                name, symbol, projectId, assetRegistry, identityRegistry, admin, pauser, msg.sender
            )
        );
    }
}

contract OfferingDeployer {
    function deploy(
        bytes32 projectId,
        IAssetRegistry assetRegistry,
        IIdentityRegistry identityRegistry,
        IRwaShareToken token,
        address router,
        address admin,
        address operator,
        address pauser
    ) external returns (address) {
        return address(
            new OfferingManager(projectId, assetRegistry, identityRegistry, token, router, admin, operator, pauser)
        );
    }
}

contract DistributorDeployer {
    function deploy(RevenueDistributor.Params calldata p) external returns (address) {
        return address(new RevenueDistributor(p));
    }
}

/// @title ProjectFactory
/// @notice Deploys and wires one project's token, offering and distributor, then links them in the
/// AssetRegistry. Only governance (DEFAULT_ADMIN_ROLE, held by the governance Safe) can deploy.
contract ProjectFactory is AccessControl {
    struct Roles {
        address admin; // governance Safe
        address operator;
        address reviewer;
        address pauser; // guardian Safe
        address feeRecipient;
    }

    struct ProjectParams {
        bytes32 projectId;
        string name;
        string symbol;
        address treasury; // issuer treasury Safe for this project
    }

    struct Deployment {
        address token;
        address offering;
        address distributor;
    }

    /// @dev Same as AssetRegistry.DEFAULT_TERM_DAYS, applied when the offering opens without a term.
    uint32 private constant DEFAULT_TERM_DAYS = 720;

    IAssetRegistry public immutable assetRegistry;
    IAuditRegistry public immutable auditRegistry;
    IIdentityRegistry public immutable identityRegistry;
    SubscriptionRouter public immutable router;
    TokenDeployer public immutable tokenDeployer;
    OfferingDeployer public immutable offeringDeployer;
    DistributorDeployer public immutable distributorDeployer;

    Roles public roles;

    event RolesUpdated(Roles roles);
    event ProjectDeployed(bytes32 indexed projectId, address token, address offering, address distributor);

    error ZeroValue();
    error ProjectNotVerified(ProjectState state);

    constructor(
        IAssetRegistry assetRegistry_,
        IAuditRegistry auditRegistry_,
        IIdentityRegistry identityRegistry_,
        SubscriptionRouter router_,
        TokenDeployer tokenDeployer_,
        OfferingDeployer offeringDeployer_,
        DistributorDeployer distributorDeployer_,
        Roles memory roles_,
        address factoryAdmin
    ) {
        if (
            address(assetRegistry_) == address(0) || address(auditRegistry_) == address(0)
                || address(identityRegistry_) == address(0) || address(router_) == address(0)
                || address(tokenDeployer_) == address(0) || address(offeringDeployer_) == address(0)
                || address(distributorDeployer_) == address(0) || factoryAdmin == address(0)
        ) revert ZeroValue();
        assetRegistry = assetRegistry_;
        auditRegistry = auditRegistry_;
        identityRegistry = identityRegistry_;
        router = router_;
        tokenDeployer = tokenDeployer_;
        offeringDeployer = offeringDeployer_;
        distributorDeployer = distributorDeployer_;
        _setRoles(roles_);
        _grantRole(DEFAULT_ADMIN_ROLE, factoryAdmin);
    }

    function setRoles(Roles calldata roles_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoles(roles_);
    }

    function deployProject(ProjectParams calldata p)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (Deployment memory d)
    {
        if (p.treasury == address(0)) revert ZeroValue();
        ProjectState s = assetRegistry.stateOf(p.projectId);
        if (s != ProjectState.VERIFIED) revert ProjectNotVerified(s);
        Roles memory r = roles;

        d.token = tokenDeployer.deploy(
            p.name, p.symbol, p.projectId, assetRegistry, identityRegistry, r.admin, r.pauser
        );
        d.offering = offeringDeployer.deploy(
            p.projectId, assetRegistry, identityRegistry, IRwaShareToken(d.token), address(router), r.admin, r.operator, r.pauser
        );

        // The term is locked once contracts are linked (AssetRegistry.setOperatingTerm), so the fee tiers
        // fixed here always match it. Unset means the default term applied when the offering opens.
        (uint32 termDays,,) = assetRegistry.termOf(p.projectId);
        if (termDays == 0) termDays = DEFAULT_TERM_DAYS;
        (uint32[] memory minUnits, uint16[] memory bps) = FeeTiers.tiersForTerm(termDays);
        d.distributor = distributorDeployer.deploy(
            RevenueDistributor.Params({
                projectId: p.projectId,
                assetRegistry: assetRegistry,
                auditRegistry: auditRegistry,
                identityRegistry: identityRegistry,
                token: IRwaShareToken(d.token),
                paymentToken: IERC20(router.USDT()),
                treasury: p.treasury,
                feeRecipient: r.feeRecipient,
                admin: r.admin,
                operator: r.operator,
                reviewer: r.reviewer,
                pauser: r.pauser,
                tierMinUnits: minUnits,
                tierBps: bps
            })
        );

        // The token's minter binder is the TokenDeployer's caller, i.e. this factory.
        IRwaShareToken(d.token).bindMinter(d.offering);
        assetRegistry.linkContracts(p.projectId, d.token, d.offering, d.distributor);
        emit ProjectDeployed(p.projectId, d.token, d.offering, d.distributor);
    }

    function _setRoles(Roles memory r) private {
        if (r.admin == address(0) || r.feeRecipient == address(0)) revert ZeroValue();
        roles = r;
        emit RolesUpdated(r);
    }
}
